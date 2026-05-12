// oxlint-disable-next-line no-unassigned-import
import "./style.css";
import tgpu, { common, d, std } from "typegpu";
import * as sdf from '@typegpu/sdf';
import { PrepareUI } from "./ui-controls";
import { Camera, setupFirstPersonCamera } from "./camera";


const root = await tgpu.init();

export const boxPositionUniform = root.createUniform(d.vec3f);
export const diskPositionUniform = root.createUniform(d.vec3f);
export const smoothnessUniform = root.createUniform(d.f32);

PrepareUI();

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const context = root.configureContext({ canvas });

const cameraUniform = root.createUniform(Camera);
const { state, updatePosition } = setupFirstPersonCamera(
  canvas,
  {
    initPos: d.vec3f(0, 0, -2),
    speed: d.vec3f(0.001, 0.1, 1),
    orbitSensitivity: 0.002,
  },
  (props) => {
    cameraUniform.writePartial(props);
  },
);

function sceneSdf(p: d.v3f) {
  "use gpu";
  const box = sdf.sdBoxFrame3d(p - boxPositionUniform.$, d.vec3f(0.12), 0.01);
  const disk = sdf.sdSphere(p - diskPositionUniform.$, 0.1);

  return sdf.opSmoothUnion(box, disk, smoothnessUniform.$);
}

function normalAt(p: d.v3f) {
  'use gpu';
  const e = 0.002;
  return std.normalize(d.vec3f(
    sceneSdf(p + d.vec3f(e, 0, 0)) - sceneSdf(p - d.vec3f(e, 0, 0)),
    sceneSdf(p + d.vec3f(0, e, 0)) - sceneSdf(p - d.vec3f(0, e, 0)),
    sceneSdf(p + d.vec3f(0, 0, e)) - sceneSdf(p - d.vec3f(0, 0, e)),
  ));
};

function march(ro: d.v3f, rd: d.v3f) {
  'use gpu';
  let t = d.f32(0);
  let hit = d.f32(0);

  for (let i = 0; i < 96; i++) {
    const dist = sceneSdf(ro + rd * t);
    if (dist < 0.002) {
      hit = 1;
      break;
    }
    t += dist;
    if (t > 6) {
      break;
    }
  }

  return d.vec2f(t, hit);
}

const pipeline = root.createRenderPipeline({
  vertex: common.fullScreenTriangle,
  fragment: ({ uv }) => {
    "use gpu";

    const screen = uv * 2 - 1; // -1 to 1
    const ro = cameraUniform.$.position; // ray origin
    const rd = std.normalize(cameraUniform.$.rotation.mul(d.vec4f(screen, 1.25, 1))).xyz; // ray direction
    const result = march(ro, rd); // x = distance, y = hit

    if (result.y < 1) { // ray didnt hit
      return d.vec4f(0, 0, 0, 1); // bg
    }

    const p = ro + rd * result.x; // hit point
    const normal = normalAt(p);
    const lightDir = std.normalize(d.vec3f(-0.35, 0.7, -0.55));
    const diffuse = 0.2 + std.max(std.dot(normal, lightDir), 0) * 0.8;

    return d.vec4f(1, 0, 0, 1) * diffuse;
  },
});

function render() {
  updatePosition();

  pipeline.withColorAttachment({ view: context }).draw(3);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
