import { DialogClose } from "@app/components/ui/dialog";
import { DialogControlIcon } from "@app/components/ui/dialog-controls";

export function RoundClose({ testid }: { testid?: string }) {
  return (
    <DialogClose data-testid={testid} aria-label="关闭" className="dialog-control">
      <DialogControlIcon name="close" />
    </DialogClose>
  );
}
