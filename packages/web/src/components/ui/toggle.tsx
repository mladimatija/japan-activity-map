import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.ts';

const toggleVariants = cva(
  "hover:text-foreground aria-pressed:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive gap-1 rounded-md text-sm font-medium transition-[color,box-shadow] [&_svg:not([class*='size-'])]:size-4 touch-target group/toggle inline-flex items-center justify-center whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border-input hover:bg-muted border bg-transparent shadow-xs',
        // On cloth (the masthead): pressed turns light, the way the page's chips turn indigo.
        cloth:
          'bg-cloth-accent text-cloth-foreground hover:bg-[color-mix(in_oklch,var(--cloth-accent),var(--cloth-foreground)_12%)] hover:text-cloth-foreground aria-pressed:bg-cloth-foreground aria-pressed:text-cloth aria-pressed:hover:bg-[color-mix(in_oklch,var(--cloth-foreground),var(--cloth)_8%)] aria-pressed:hover:text-cloth focus-visible:border-cloth-foreground/70 focus-visible:ring-cloth-foreground/40',
      },
      size: {
        default:
          'h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: 'h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
        lg: 'h-10 min-w-10 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Toggle = ({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) => (
  <TogglePrimitive
    data-slot="toggle"
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
);

export { Toggle, toggleVariants };
