// oxlint-disable-next-line no-unassigned-import
import "./style.css";
import tgpu, { common, d } from "typegpu";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<canvas id="canvas" width="256" height="256"></canvas>
`;

const root = await tgpu.init();

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const context = root.configureContext({ canvas });

const pipeline = root.createRenderPipeline({
  vertex: common.fullScreenTriangle,
  fragment: ({ uv }) => {
    "use gpu";
    return d.vec4f(uv, 0, 1);
  },
});

pipeline.withColorAttachment({ view: context }).draw(3);
