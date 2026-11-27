/** Whether a menu, popover or dialog is open; Esc then belongs to it, not to the detail behind it. */
export const popoverOpen = () =>
  document.querySelector(
    '[data-slot$="-content"][data-open]:not([data-pane] *), [role="dialog"][data-open]:not([data-pane]), [role="listbox"][data-open]',
  ) !== null;
