import { cn } from "@/lib/utils";

export function AuthPrivacyLink({
  href,
  className,
  label = "Datenschutz",
}: {
  href: string | null;
  className?: string;
  label?: string;
}) {
  if (!href) return null;
  return (
    <a
      className={cn("focus-ring hover:underline", className)}
      href={href}
    >
      {label}
    </a>
  );
}
