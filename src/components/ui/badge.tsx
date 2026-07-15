import { cn } from "@/lib/utils";

const styles = {
  neutral: "border-[#e1e5e8] bg-[#f4f6f7] text-[#5a6875]",
  teal: "border-[#b9e8e3] bg-[#e9f8f6] text-[#167e74]",
  coral: "border-[#f4c8c2] bg-[#fdf0ee] text-[#b84e42]",
  amber: "border-[#ead9a8] bg-[#fbf6e7] text-[#8d6a12]",
  blue: "border-[#cedbed] bg-[#eef3f9] text-[#365f8d]",
  navy: "border-[#bcc9d4] bg-[#eaf0f4] text-[#17324d]",
} as const;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof styles;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", styles[tone], className)}>
      {children}
    </span>
  );
}
