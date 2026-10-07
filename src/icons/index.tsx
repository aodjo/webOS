/**
 * Icon set: squircle app icons in the macOS 26 Liquid Glass finish, Finder file icons and the OS logo.
 * All icons are inline SVG (no external images, except the image a thumbnail shows) and render a
 * `size`×`size` px element. Gradient/filter ids are unique per instance (React `useId`).
 */
export {
  FinderIcon,
  LaunchpadIcon,
  SafariIcon,
  MailIcon,
  NotesIcon,
  AboutMeIcon,
  ProjectsIcon,
  TerminalIcon,
  LinuxIcon,
  TextEditIcon,
  PreviewIcon,
  CalculatorIcon,
  SettingsIcon,
  ActivityMonitorIcon,
  AboutThisMacIcon,
  WelcomeIcon,
  MinesweeperIcon,
  GenericAppIcon,
} from './apps';
export { TrashIcon, TrashFullIcon, HardDriveIcon, OSLogo } from './system';
export { FileIcon, FolderIcon, DocumentIcon, folderGlyphFor } from './files';
export type { FileIconNode, FolderGlyph } from './files';
export { AppIconFrame, squirclePath, SQUIRCLE, useIconIds } from './shared';
export type { IconFC } from './shared';
