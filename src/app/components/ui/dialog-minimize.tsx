import { Button } from "@base-ui/react/button";
import { Sym } from "@app/screens/shared/Sym";
import { TESTIDS } from "@app/screens/game/testids";

export function DialogMinimize({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      className="dialog-minimize"
      data-testid={TESTIDS.modalMinimize}
      aria-label="最小化弹窗"
      onClick={onClick}
    >
      <span aria-hidden="true">
        <Sym name="minus" size={15} />
      </span>
    </Button>
  );
}
