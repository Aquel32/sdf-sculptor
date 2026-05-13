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

let debugBoundings = 0;
const debugBoundingsUniform = root.createUniform(d.u32);
export function setDebugBoundings(value: number) {
  debugBoundings = value;
  debugBoundingsUniform.write(value);
}

PrepareUI();

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const context = root.configureContext({ canvas });

const cameraUniform = root.createUniform(Camera);
const { state: cameraState, updatePosition } = setupFirstPersonCamera(
  canvas,
  {
    initPos: d.vec3f(0, 0.12, -0.01),
    speed: d.vec3f(0.001, 0.01, 1),
    orbitSensitivity: 0.002,
  },
  (props) => {
    cameraUniform.writePartial(props);
  },
);

const MAX_DYNAMIC_SPHERES = 1000;
const dynamicSpheresBuffer = root.createBuffer(d.arrayOf(d.vec4f, MAX_DYNAMIC_SPHERES)).$usage("storage");

let dynamicSpheresCount = 1;
const dynamicSpheresCountBuffer = root.createBuffer(d.u32).$usage("storage");
dynamicSpheresCountBuffer.write(dynamicSpheresCount);

const dynamicSpheresArray = new Float32Array(MAX_DYNAMIC_SPHERES * 4);
dynamicSpheresArray.set([0, 0, 0, 0.1], 0); // initial sphere
dynamicSpheresBuffer.write(dynamicSpheresArray);

const mainLayout = tgpu.bindGroupLayout({
  spheres: { storage: d.arrayOf(d.vec4f), access: "mutable" },
  count: { storage: d.u32, access: "mutable" },
});

const mainBindGroup = root.createBindGroup(mainLayout, {
  spheres: dynamicSpheresBuffer,
  count: dynamicSpheresCountBuffer,
});

const foundPositionMutable = root.createMutable(d.vec4f);
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
    foundPositionMutable.$ = d.vec4f(0, 0, 0, 0);
    return;
  }

  const r = 0.1;
  const p = ro + rd * result.x - rd * r

  foundPositionMutable.$ = d.vec4f(p, r);
})

window.addEventListener("keydown", async (event: KeyboardEvent) => {
  if (event.key.toLowerCase() === "e") {
    addDynamicSphereComputePipeline.
      with(mainBindGroup).
      dispatchThreads();

    if (debugBoundings === 1) {
      return;
    }

    const foundPosition = await foundPositionMutable.read();

    if (std.allEq(foundPosition, d.vec4f(0, 0, 0, 0))) {
      return;
    }

    dynamicSpheresCount++;
    dynamicSpheresCountBuffer.write(dynamicSpheresCount);

    const index = (dynamicSpheresCount - 1) * 4;
    dynamicSpheresArray[index] = foundPosition.x;
    dynamicSpheresArray[index + 1] = foundPosition.y;
    dynamicSpheresArray[index + 2] = foundPosition.z;
    dynamicSpheresArray[index + 3] = foundPosition.w;

    dynamicSpheresBuffer.write(dynamicSpheresArray);

    console.log("Added sphere", dynamicSpheresCount);
  }
});

function sceneSdf(p: d.v3f) {
  "use gpu";

  let result = d.f32(1);

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

  let closestIntersection = d.f32(9090);
  let farthestIntersection = d.f32(-1);
  for (let i = d.u32(0); i < mainLayout.$.count; i++) {
    const spherePos = mainLayout.$.spheres[i].xyz;
    const sphereRadius = mainLayout.$.spheres[i].w;

    const aabb = aabbSphere(spherePos, sphereRadius, smoothnessUniform.$);
    const intersection = rayAABBIntersection(ro, rd, aabb);

    if (intersection.near !== -1) {
      closestIntersection = std.min(closestIntersection, intersection.near);
      farthestIntersection = std.max(farthestIntersection, intersection.far);
    }
  }

  // ray didnt hit, skip marching
  if (closestIntersection === 9090) {
    return d.vec2f(t, hit);
  }
  t = closestIntersection;

  if (debugBoundingsUniform.$ > 0) {
    if (asd) {
      console.log("t", closestIntersection, farthestIntersection);
    }

    hit = 1;
    return d.vec2f(t, hit);
  }

  let stepsDone = 0;
  for (let i = 0; i < 32; i++) {
    const dist = sceneSdf(ro + rd * t);
    if (dist < 0.002) {
      hit = 1;
      break;
    }
    t += dist;
    if (t > farthestIntersection) {
      break;
    }
    stepsDone = i;
  }

  if (asd) {
    console.log("Steps done: ", stepsDone, t, closestIntersection, farthestIntersection);
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

    const result = march(ro, rd, false); // x = distance, y = hit

    if (debugBoundingsUniform.$ > 0) {
      if (result.x === 0) {
        return d.vec4f(0, 0, 0, 1);
      }

      return d.vec4f(1, 0, 0, 1);
    }

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
