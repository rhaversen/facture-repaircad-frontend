/** The few glyphs the app uses, drawn in currentColor so they follow the text around them. */
import type { ReactNode } from "react";

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type Props = { size?: number };

export const PlusIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
);
export const BackIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M12 4.5 6.5 10l5.5 5.5" />
  </Icon>
);
export const NextIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M8 4.5 13.5 10 8 15.5" />
  </Icon>
);
export const ChevronDownIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="m5.5 8 4.5 4.5L14.5 8" />
  </Icon>
);
export const CheckIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);
export const CloseIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);
export const PhotoIcon = ({ size }: Props) => (
  <Icon size={size}>
    <rect x="3" y="4.5" width="14" height="11" rx="2" />
    <circle cx="7.5" cy="8.5" r="1.3" />
    <path d="m3.5 14 4-4 3 3 2-2 4 4" />
  </Icon>
);
export const DownloadIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M10 3.5V13M6 9l4 4 4-4M4 13.5V16h12v-2.5" />
  </Icon>
);
export const WrenchIcon = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M12.5 3.5a4 4 0 0 0-3.8 5.3L3.8 13.7a1.6 1.6 0 0 0 2.3 2.3l4.9-4.9a4 4 0 0 0 5.3-3.8l-2.3 2.3-2.3-.6-.6-2.3z" />
  </Icon>
);
