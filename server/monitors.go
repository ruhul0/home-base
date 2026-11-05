package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"strconv"
	"sync"
	"time"
)

const (
	defaultMonitorInterval = 2 * time.Minute
	monitorWorkers         = 16
	maxScheduledMonitors   = 2000
	monitorHistoryPoints   = 48
	monitorRetentionDays   = 7
	monitorCleanupEvery    = time.Hour
)

// MonitorPoint is one past check, for the history bars.
type MonitorPoint struct {
	At time.Time `json:"at"`
	Up bool      `json:"up"`
	Ms int64     `json:"ms"`
}

// MonitorHistory summarises recent background checks of one address.
type MonitorHistory struct {
	Points    []MonitorPoint `json:"points"`
	Uptime24h *float64       `json:"uptime24h"`
	DownSince *time.Time     `json:"downSince"`
}

func monitorKey(address string) string {
	sum := sha256.Sum256([]byte(address))
	return hex.EncodeToString(sum[:])
}

func monitorInterval() time.Duration {
	if seconds, err := strconv.Atoi(os.Getenv("MONITOR_INTERVAL_SECONDS")); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return defaultMonitorInterval
}

// runMonitorScheduler checks every saved address in the background, whether or not anyone has the
// page open. Each address is checked once per round, however many users watch it.
func (a *App) runMonitorScheduler(ctx context.Context) {
	if os.Getenv("MONITOR_SCHEDULER") == "off" {
		return
	}
	ticker := time.NewTicker(monitorInterval())
	defer ticker.Stop()
	lastCleanup := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if err := a.checkAllMonitors(ctx); err != nil && ctx.Err() == nil {
			log.Printf("monitor round failed: %v", err)
		}
		if time.Since(lastCleanup) >= monitorCleanupEvery {
			lastCleanup = time.Now()
			if err := a.store.deleteOldMonitorChecks(ctx); err != nil {
				log.Printf("removing old monitor checks failed: %v", err)
			}
		}
	}
}

func (a *App) checkAllMonitors(ctx context.Context) error {
	addresses, err := a.store.allMonitorAddresses(ctx)
	if err != nil {
		return err
	}

	work := make(chan string)
	var group sync.WaitGroup
	for range monitorWorkers {
		group.Add(1)
		go func() {
			defer group.Done()
			for address := range work {
				result := a.dev.check(ctx, address)
				if err := a.store.saveMonitorCheck(ctx, address, result); err != nil && ctx.Err() == nil {
					log.Printf("saving a monitor check failed: %v", err)
				}
			}
		}()
	}
	for _, address := range addresses {
		select {
		case work <- address:
		case <-ctx.Done():
		}
	}
	close(work)
	group.Wait()
	return nil
}

func (s *Store) allMonitorAddresses(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT data FROM user_workspaces")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seen := map[string]bool{}
	addresses := []string{}
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		var workspace Workspace
		if err := json.Unmarshal([]byte(data), &workspace); err != nil {
			continue
		}
		for _, monitor := range workspace.Monitors {
			if !seen[monitor.URL] && len(addresses) < maxScheduledMonitors {
				seen[monitor.URL] = true
				addresses = append(addresses, monitor.URL)
			}
		}
	}
	return addresses, rows.Err()
}

func (s *Store) saveMonitorCheck(ctx context.Context, address string, result MonitorResult) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO monitor_checks (url_hash, checked_at, up, status, ms) VALUES (?, UTC_TIMESTAMP(), ?, ?, ?)",
		monitorKey(address), result.Up, result.Status, result.Ms)
	return err
}

func (s *Store) deleteOldMonitorChecks(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM monitor_checks WHERE checked_at < UTC_TIMESTAMP() - INTERVAL ? DAY", monitorRetentionDays)
	return err
}

func (s *Store) monitorHistory(ctx context.Context, address string) (MonitorHistory, error) {
	key := monitorKey(address)
	history := MonitorHistory{Points: []MonitorPoint{}}

	rows, err := s.db.QueryContext(ctx,
		"SELECT checked_at, up, ms FROM monitor_checks WHERE url_hash = ? ORDER BY checked_at DESC, id DESC LIMIT ?",
		key, monitorHistoryPoints)
	if err != nil {
		return history, err
	}
	defer rows.Close()
	for rows.Next() {
		var point MonitorPoint
		if err := rows.Scan(&point.At, &point.Up, &point.Ms); err != nil {
			return history, err
		}
		history.Points = append(history.Points, point)
	}
	if err := rows.Err(); err != nil {
		return history, err
	}

	// Rows arrive newest first, so the outage started at the last failure before a success.
	for index := range history.Points {
		if history.Points[index].Up {
			break
		}
		history.DownSince = &history.Points[index].At
	}
	for left, right := 0, len(history.Points)-1; left < right; left, right = left+1, right-1 {
		history.Points[left], history.Points[right] = history.Points[right], history.Points[left]
	}

	var total, up int
	err = s.db.QueryRowContext(ctx,
		`SELECT COUNT(*), COALESCE(SUM(up), 0) FROM monitor_checks
		 WHERE url_hash = ? AND checked_at > UTC_TIMESTAMP() - INTERVAL 24 HOUR`, key).Scan(&total, &up)
	if err != nil {
		return history, err
	}
	if total > 0 {
		percent := float64(up) / float64(total) * 100
		history.Uptime24h = &percent
	}
	return history, nil
}
