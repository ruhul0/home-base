import {
  BellIcon, BookIcon, BookOpenIcon, BotIcon, BriefcaseIcon, Building2Icon, CalendarIcon, CameraIcon, CarIcon,
  ChartLineIcon, ClockIcon, CloudIcon, CodeIcon, CoffeeIcon, CreditCardIcon, DatabaseIcon, DumbbellIcon,
  FileTextIcon, FilmIcon, FolderIcon, Gamepad2Icon, GiftIcon, GlobeIcon, GraduationCapIcon, HeadphonesIcon,
  HeartIcon, HomeIcon, ImageIcon, LandmarkIcon, LockIcon, MailIcon, MapIcon, MessageCircleIcon, MusicIcon,
  NewspaperIcon, PlaneIcon, RocketIcon, SearchIcon, ServerIcon, SettingsIcon, ShieldIcon, ShoppingCartIcon,
  SparklesIcon, StarIcon, StethoscopeIcon, TerminalIcon, TvIcon, UsersIcon, UtensilsIcon, VideoIcon, WalletIcon,
  WrenchIcon, ZapIcon, type LucideIcon,
} from "lucide-react";

/** Saved links refer to these by name, so existing names must never be changed or removed. */
export const ICON_SET: Record<string, LucideIcon> = {
  home: HomeIcon, globe: GlobeIcon, search: SearchIcon, star: StarIcon, heart: HeartIcon, sparkles: SparklesIcon,
  mail: MailIcon, "message-circle": MessageCircleIcon, users: UsersIcon, bell: BellIcon, calendar: CalendarIcon, clock: ClockIcon,
  music: MusicIcon, video: VideoIcon, film: FilmIcon, tv: TvIcon, headphones: HeadphonesIcon, "gamepad-2": Gamepad2Icon,
  image: ImageIcon, camera: CameraIcon, newspaper: NewspaperIcon, book: BookIcon, "book-open": BookOpenIcon, "graduation-cap": GraduationCapIcon,
  briefcase: BriefcaseIcon, "building-2": Building2Icon, "chart-line": ChartLineIcon, landmark: LandmarkIcon, wallet: WalletIcon, "credit-card": CreditCardIcon,
  "shopping-cart": ShoppingCartIcon, gift: GiftIcon, code: CodeIcon, terminal: TerminalIcon, server: ServerIcon, database: DatabaseIcon,
  cloud: CloudIcon, bot: BotIcon, rocket: RocketIcon, zap: ZapIcon, settings: SettingsIcon, wrench: WrenchIcon,
  shield: ShieldIcon, lock: LockIcon, folder: FolderIcon, "file-text": FileTextIcon, map: MapIcon, plane: PlaneIcon,
  car: CarIcon, coffee: CoffeeIcon, utensils: UtensilsIcon, dumbbell: DumbbellIcon, stethoscope: StethoscopeIcon,
};
