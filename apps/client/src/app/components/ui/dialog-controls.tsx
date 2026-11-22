import { Button } from "@base-ui/react/button";
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "@app/screens/game/testids";

export function DialogControlIcon({ name }: { name: "minus" | "close" }) {
  return (
    <span aria-hidden="true">
      <Sym name={name} size={16} />
    </span>
  );
}

export function DialogMinimize({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      className="dialog-control dialog-minimize"
      data-testid={TESTIDS.modalMinimize}
      aria-label="最小化弹窗"
      onClick={onClick}
    >
      <DialogControlIcon name="minus" />
    </Button>
  );
}
