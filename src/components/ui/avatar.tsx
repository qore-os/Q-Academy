import { cn, initials } from "@/lib/utils";
import { safeAvatarSource } from "@/lib/avatar-policy";

const palette = ["bg-[#dff3f0] text-[#167e74]", "bg-[#e6edf5] text-[#365f8d]", "bg-[#f9e7e4] text-[#b84e42]", "bg-[#f6efd9] text-[#8d6a12]"];

function backgroundImage(value?: string | null) {
  const source = safeAvatarSource(value);
  return source ? `url("${source}")` : undefined;
}

export function Avatar({
  firstName,
  lastName,
  src,
  size = "md",
  className,
}: {
  firstName: string;
  lastName: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const index = (firstName.charCodeAt(0) + lastName.charCodeAt(0)) % palette.length;
  const sizes = { sm: "size-7 text-[10px]", md: "size-9 text-xs", lg: "size-11 text-sm", xl: "size-16 text-lg" };
  const image = backgroundImage(src);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-cover bg-center font-bold",
        palette[index],
        sizes[size],
        className,
      )}
      style={image ? { backgroundImage: image } : undefined}
      aria-label={`${firstName} ${lastName}`}
      role={image ? "img" : undefined}
    >
      {image ? null : initials(firstName, lastName)}
    </span>
  );
}
