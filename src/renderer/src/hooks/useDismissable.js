import { useEffect } from 'react';

// Closes a kebab/dropdown menu on an outside click or Escape. `ref` must
// point at the menu's positioning container (button + popover), not just
// the popover itself, so a click on the trigger button doesn't immediately
// re-open what it just closed. Only attaches listeners while `active` is
// true — cheap to call unconditionally from every row of a list.
export function useDismissable(ref, onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;

    function handlePointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, onClose, active]);
}
