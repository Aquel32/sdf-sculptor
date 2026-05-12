// oxlint-disable-next-line no-unassigned-import
import "./style.css";
import tgpu, { common, d, std } from "typegpu";
import * as sdf from '@typegpu/sdf';
import { PrepareUI } from "./ui-controls";
import { Camera, setupFirstPersonCamera } from "./camera";
import { aabbSphere, rayAABBIntersection } from "./distance-functions";


const root = await tgpu.init();

export const boxPositionUniform = root.createUniform(d.vec3f);
export const diskPositionUniform = root.createUniform(d.vec3f);
export const smoothnessUniform = root.createUniform(d.f32);

PrepareUI();

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const context = root.configureContext({ canvas });

const cameraUniform = root.createUniform(Camera);
const { state: cameraState, updatePosition } = setupFirstPersonCamera(
  canvas,
  {
    initPos: d.vec3f(0, 0, -1),
    speed: d.vec3f(0.001, 0.1, 1),
    orbitSensitivity: 0.002,
  },
  (props) => {
    cameraUniform.writePartial(props);
  },
);

const MAX_DYNAMIC_SPHERES = 1000;
const dynamicSpheresBuffer = root.createBuffer(d.arrayOf(d.vec4f, MAX_DYNAMIC_SPHERES)).$usage("storage");
const dynamicSpheresCountBuffer = root.createBuffer(d.u32).$usage("storage");
dynamicSpheresCountBuffer.write(1);

const test = new Float32Array([0, 0, 0, 0.1]);
dynamicSpheresBuffer.write(test);

const mainLayout = tgpu.bindGroupLayout({
  spheres: { storage: d.arrayOf(d.vec4f), access: "mutable" },
  count: { storage: d.u32, access: "mutable" },
});

const mainBindGroup = root.createBindGroup(mainLayout, {
  spheres: dynamicSpheresBuffer,
  count: dynamicSpheresCountBuffer,
});

const addDynamicSphereComputePipeline = root.createGuardedComputePipeline(() => {
  "use gpu";

  if (mainLayout.$.count >= MAX_DYNAMIC_SPHERES) {
    return;
  }

  const ray = getRay(cameraUniform.$.mouse);
  const ro = ray.ro;
  const rd = ray.rd;

  const result = march(ro, rd, true); // x = distance, y = hit

  if (result.y < 1) {
    return;
  }

  const r = 0.1;
  const p = ro + rd * result.x - rd * r

  mainLayout.$.spheres[mainLayout.$.count] = d.vec4f(p, r);
  mainLayout.$.count = mainLayout.$.count + 1;
})

window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key.toLowerCase() === "e") {
    addDynamicSphereComputePipeline.
      with(mainBindGroup).
      dispatchThreads();
  }
});

function sceneSdf(p: d.v3f) {
  "use gpu";
  const box = sdf.sdBoxFrame3d(p - boxPositionUniform.$, d.vec3f(0.12), 0.01);
  const disk = sdf.sdSphere(p - diskPositionUniform.$, 0.1);

  let result = sdf.opSmoothUnion(box, disk, smoothnessUniform.$);

  for (let i = d.u32(0); i < mainLayout.$.count; i++) {
    const spherePos = mainLayout.$.spheres[i].xyz;
    const sphereRadius = mainLayout.$.spheres[i].w;

    const sphereSdf = sdf.sdSphere(p - spherePos, sphereRadius);
    result = sdf.opSmoothUnion(result, sphereSdf, smoothnessUniform.$);
  }

  return result;
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

const Ray = d.struct({
  ro: d.vec3f,
  rd: d.vec3f,
});

function march(ro: d.v3f, rd: d.v3f, asd: boolean) {
  'use gpu';
  let t = d.f32(0);
  let hit = d.f32(0);

  // let closestIntersection = d.f32(9090);
  // for (let i = d.u32(0); i < mainLayout.$.count; i++) {
  //   const spherePos = mainLayout.$.spheres[i].xyz;
  //   const sphereRadius = mainLayout.$.spheres[i].w;

  //   const aabb = aabbSphere(spherePos, sphereRadius, smoothnessUniform.$);
  //   const intersection = rayAABBIntersection(ro, rd, aabb);

  //   if (intersection !== -1) {
  //     closestIntersection = std.min(closestIntersection, intersection);
  //   }
  // }

  // if (closestIntersection !== 9090) {
  //   t = closestIntersection;
  // }

  // if (asd) {
  //   console.log(t, closestIntersection);
  // }

  for (let i = 0; i < 32; i++) {
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

function getRay(uv: d.v2f) {
  "use gpu";

  const screen = d.vec4f(uv * 2 - 1, -1, 1);

  const viewPos = cameraUniform.$.inverseProjection.mul(screen);
  const viewPosNormalized = d.vec4f(viewPos.xyz / viewPos.w, 1);

  const worldPos = cameraUniform.$.inverseView.mul(viewPosNormalized);

  const ro = cameraUniform.$.inverseView.columns[3].xyz
  const rd = std.normalize(worldPos.xyz - ro); // ray direction

  return Ray({ ro, rd });
}

const pipeline = root.createRenderPipeline({
  vertex: common.fullScreenTriangle,
  fragment: ({ uv }) => {
    "use gpu";

    const ray = getRay(uv);
    const ro = ray.ro;
    const rd = ray.rd;

    // const rd = std.normalize(cameraUniform.$.rotation.mul(d.vec4f(screen, 1.25, 1))).xyz; // ray direction
    const result = march(ro, rd, false); // x = distance, y = hit

    // if (result.x === 0) {
    //   return d.vec4f(0, 0, 0, 1);
    // }

    // return d.vec4f(1, 0, 0, 1);

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

  pipeline.
    withColorAttachment({ view: context }).
    with(mainBindGroup).
    draw(3);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
