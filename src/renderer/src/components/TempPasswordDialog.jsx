import { Copy, KeyRound } from 'lucide-react';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/lib/toast';

// Shown exactly once after an invite that created a brand-new login. The
// password is never stored anywhere — closing this is the last chance.
export const TempPasswordDialog = ({ open, email, password, onClose }) => {
  const toast = useToast();
  if (!open) return null;
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(`Email: ${email}\nTemporary password: ${password}`);
      toast('Login details copied.', 'success');
    } catch {
      toast("Couldn't copy — select the password above and copy it manually.", 'error');
    }
  };
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <div className="flex items-start justify-between p-5 pb-0">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-primary" /> Login created
        </div>
        <DialogClose onClick={onClose} />
      </div>
      <div className="flex flex-col gap-3 p-5 text-sm">
        <p className="text-muted-foreground">Hand these to the person out-of-band. This password is shown only once.</p>
        <div className="rounded-md bg-secondary px-3 py-2 font-mono text-xs">
          <div>Email: {email}</div>
          <div className="mt-1">Temporary password: <span className="font-semibold text-foreground">{password}</span></div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose}>Done</Button>
        <Button size="sm" onClick={copy}><Copy className="h-4 w-4" /> Copy</Button>
      </div>
    </Dialog>
  );
};
