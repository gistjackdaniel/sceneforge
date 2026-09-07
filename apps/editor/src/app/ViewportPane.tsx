import { StagePanel } from "../panels/stage/StagePanel";

export const ViewportPane = ({ alwaysActive = false }: { alwaysActive?: boolean }) => (
  <section className="viewport-pane" aria-label="Viewport">
    <div className="viewport-pane-body">
      <StagePanel compact alwaysActive={alwaysActive} />
    </div>
  </section>
);

