// oxlint-disable-next-line no-unassigned-import
import "./style.css";
import tgpu, { common, d, std } from "typegpu";
import * as sdf from '@typegpu/sdf';
import { PrepareUI } from "./ui-controls";
import { Camera, setupFirstPersonCamera } from "./camera";
import { aabbSphere, frustumIntersectsAABB, rayAABBIntersection } from "./distance-functions";

const PIXEL_RATIO = window.devicePixelRatio;

const root = await tgpu.init();


const tilesCountUniform = root.createUniform(d.vec2f);
const tiles = d.vec2f(2, 2);
export function setTiles(x: number, y: number) {
  tiles.x = x;
  tiles.y = y;
  tilesCountUniform.write(tiles);
}
const currentTileUniform = root.createUniform(d.vec2u);

let smoothness = 0.001;
export const smoothnessUniform = root.createUniform(d.f32);
export function setSmoothness(value: number) {
  smoothness = value;
  smoothnessUniform.write(value);
}

let debugBoundings = 0;
const debugBoundingsUniform = root.createUniform(d.u32);
export function setDebugBoundings(value: number) {
  debugBoundings = value;
  debugBoundingsUniform.write(value);
}

PrepareUI();

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const context = root.configureContext({ canvas });

export const MAX_TILES = 2;
export const [width, height] = [canvas.clientWidth, canvas.clientHeight].map(v => v * PIXEL_RATIO);

const finalTexture = root.createTexture({
  size: [width, height],
  format: "rgba8unorm",
}).$usage("storage", "sampled");
const writeView = finalTexture.createView(d.textureStorage2d("rgba8unorm", "write-only"));
const sampledView = finalTexture.createView(d.texture2d());
const sampler = root.createSampler({
  magFilter: "linear",
  minFilter: "linear",
});

const cameraUniform = root.createUniform(Camera);
const { state: cameraState, updatePosition, updateFrustum } = setupFirstPersonCamera(
  canvas,
  {
    initPos: d.vec3f(0, 0.00, 0),
    speed: d.vec3f(0.001, 0.01, 1),
    orbitSensitivity: 0.002,
  },
  tiles,
  (props) => {
    cameraUniform.writePartial(props);
  },
);

const MAX_DYNAMIC_SPHERES = 10;
const dynamicSpheresBuffer = root.createBuffer(d.arrayOf(d.vec4f, MAX_DYNAMIC_SPHERES)).$usage("storage");

let dynamicSpheresCount = 1;
const dynamicSpheresCountBuffer = root.createBuffer(d.u32).$usage("storage");
dynamicSpheresCountBuffer.write(dynamicSpheresCount);

const dynamicSpheresArray = new Float32Array(MAX_DYNAMIC_SPHERES * 4);
dynamicSpheresArray.set([0, 0, 1, 0.1], 0); // initial sphere
dynamicSpheresBuffer.write(dynamicSpheresArray);

const indexesInTileBuffer = root.createBuffer(d.arrayOf(d.arrayOf(d.arrayOf(d.i32, MAX_DYNAMIC_SPHERES), MAX_TILES), MAX_TILES)).$usage("storage");
const indexesInTileArray = d.arrayOf(d.arrayOf(d.arrayOf(d.i32, MAX_DYNAMIC_SPHERES), MAX_TILES), MAX_TILES)();

const mainLayout = tgpu.bindGroupLayout({
  spheres: { storage: d.arrayOf(d.vec4f), access: "mutable" },
  count: { storage: d.u32, access: "mutable" },
  indexesInTile: { storage: d.arrayOf(d.arrayOf(d.arrayOf(d.i32, MAX_DYNAMIC_SPHERES), MAX_TILES), MAX_TILES), access: "mutable" },
});

const mainBindGroup = root.createBindGroup(mainLayout, {
  spheres: dynamicSpheresBuffer,
  count: dynamicSpheresCountBuffer,
  indexesInTile: indexesInTileBuffer,
});

const foundPositionMutable = root.createMutable(d.vec4f);
const addDynamicSphereComputePipeline = root.createGuardedComputePipeline(() => {
  "use gpu";

  if (mainLayout.$.count >= MAX_DYNAMIC_SPHERES) {
    return;
  }

  const ray = getRay(cameraUniform.$.mouse);


  const tileSize = 1 / tilesCountUniform.$;
  const tile = d.vec2u(std.floor(cameraUniform.$.mouse / PIXEL_RATIO / tileSize));

  const ro = ray.ro;
  const rd = ray.rd;

  const result = march(ro, rd, true, tile); // x = distance, y = hit

  if (result.y < 1) {
    foundPositionMutable.$ = d.vec4f(0, 0, 0, 0);
    return;
  }

  const r = 0.1;
  const p = ro + rd * result.x - rd * r

  foundPositionMutable.$ = d.vec4f(p, r);
})

window.addEventListener("keydown", async (event: KeyboardEvent) => {
  if (event.key.toLowerCase() === "f") {
    updateFrustum();
    prepareTiles();
  }

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

function march(ro: d.v3f, rd: d.v3f, asd: boolean, tile: d.v2u) {
  'use gpu';
  let t = d.f32(0);
  let hit = d.f32(0);

  let closestIntersection = d.f32(9090);
  let farthestIntersection = d.f32(-1);

  for (let i = 0; i < MAX_DYNAMIC_SPHERES; i++) {
    const sphereIndex = mainLayout.$.indexesInTile[tile.x][tile.y][i];
    if (sphereIndex === -1) {
      break;
    }

    const spherePos = mainLayout.$.spheres[i].xyz;
    const sphereRadius = mainLayout.$.spheres[i].w;

    const aabb = aabbSphere(spherePos, sphereRadius, smoothnessUniform.$);
    const intersection = rayAABBIntersection(ro, rd, aabb);

    if (intersection.near !== -1) {
      closestIntersection = std.min(closestIntersection, intersection.near);
      farthestIntersection = std.max(farthestIntersection, intersection.far);
    }
  }

  // for (let i = d.u32(0); i < mainLayout.$.count; i++) {
  //   const spherePos = mainLayout.$.spheres[i].xyz;
  //   const sphereRadius = mainLayout.$.spheres[i].w;

  //   const aabb = aabbSphere(spherePos, sphereRadius, smoothnessUniform.$);
  //   const intersection = rayAABBIntersection(ro, rd, aabb);

  //   if (intersection.near !== -1) {
  //     closestIntersection = std.min(closestIntersection, intersection.near);
  //     farthestIntersection = std.max(farthestIntersection, intersection.far);
  //   }
  // }

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

  const screen = d.vec4f(uv * 2 - 1, 0, 1);

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

    const color = std.textureSample(sampledView.$, sampler.$, uv);
    return color;
  },
});

function writeToTexture(xy: d.v2u, color: d.v4f) {
  "use gpu";
  std.textureStore(writeView.$, xy, color);
}

const tilePipeline = root.createGuardedComputePipeline((x, y) => {
  "use gpu";

  const textureSize = d.vec2f(std.textureDimensions(writeView.$))
  const tile = currentTileUniform.$;
  const tileSize = d.vec2u((textureSize) / tilesCountUniform.$);

  const xy = d.vec2u(x + tile.x * tileSize.x, y + tile.y * tileSize.y);
  const uv = d.vec2f(xy) / textureSize;

  if (tile.x === 1 && tile.y === 0) {
    if (x === 0 && y === 0) {
      console.log(xy, uv, getRay(uv));
      // console.log("GPU:", tile.x, tile.y, mainLayout.$.indexesInTile[tile.x][tile.y]);
    }
  }


  const ray = getRay(uv);
  const ro = ray.ro;
  const rd = ray.rd;

  const result = march(ro, rd, false, tile); // x = distance, y = hit

  if (debugBoundingsUniform.$ > 0) {
    if (result.x === 0) {
      writeToTexture(xy, d.vec4f(0, 0, 0, 1));
      return;
    }

    writeToTexture(xy, d.vec4f(1, 0, 0, 1));
    return;
  }

  if (result.y < 1) { // ray didnt hit
    writeToTexture(xy, d.vec4f(0, 0, 0, 1));
    return;
  }

  const p = ro + rd * result.x; // hit point
  const normal = normalAt(p);
  const lightDir = std.normalize(d.vec3f(-0.35, 0.7, -0.55));
  const diffuse = 0.2 + std.max(std.dot(normal, lightDir), 0) * 0.8;

  const color = d.vec4f(1, 0, 0, 1) * diffuse;
  writeToTexture(xy, color);
});

function frustumTest() {
  for (let i = 0; i < dynamicSpheresCount; i++) {
    const index = i * 4;
    const pos = d.vec3f(dynamicSpheresArray[index], dynamicSpheresArray[index + 1], dynamicSpheresArray[index + 2]);
    const radius = dynamicSpheresArray[index + 3];

    const aabb = aabbSphere(pos, radius, smoothness);

    if (frustumIntersectsAABB(cameraState.frustum[0][0], aabb)) {
      console.log("Sphere", i, "is visible");
    }
    else {
      console.log("Sphere", i, "is NOT visible");
    }
  }
}

function buildTile(x: number, y: number) {
  "use gpu";

  const tileFrustum = cameraState.frustum[x][y];

  for (let i = 0; i < MAX_DYNAMIC_SPHERES; i++) {
    indexesInTileArray[x][y][i] = -1;
  }

  let objectsInTile = 0;
  for (let i = 0; i < dynamicSpheresCount; i++) {
    const index = i * 4;
    const pos = d.vec3f(dynamicSpheresArray[index], dynamicSpheresArray[index + 1], dynamicSpheresArray[index + 2]);
    const radius = dynamicSpheresArray[index + 3];

    const aabb = aabbSphere(pos, radius, smoothness);

    if (frustumIntersectsAABB(tileFrustum, aabb)) {
      // console.log("Sphere", i, "is visible in tile", x, y);
      indexesInTileArray[x][y][objectsInTile] = i;
      objectsInTile += 1;
    }
  }
  return objectsInTile
}

function prepareTiles() {
  const result: number[][] = [];
  let sum = 0;
  for (let y = 0; y < tiles.y; y++) {
    const row: number[] = [];
    for (let x = 0; x < tiles.x; x++) {
      const count = buildTile(x, y);
      row.push(count);
      sum += count;
    }
    result.push(row);
  }

  const tileTotalCount = tiles.x * tiles.y;

  // console.log(indexesInTileArray.map(r => r.map(c => c.join(",")).join(" | ")).join("\n"));




  for (let x = 0; x < tiles.x; x++) {
    for (let y = 0; y < tiles.y; y++) {
      // console.log("CPU:", y, x, indexesInTileArray[y][x])
    }
  }

  indexesInTileBuffer.write(indexesInTileArray);
  // console.log(result.map(r => r.join(" ")).join("\n"));
  // const before = dynamicSpheresCount;
  // sum /= tileTotalCount;
  // console.log(`avg obj/tile: ${sum}. (before: ${before}). (${(sum / before * 100).toFixed(2)}%)`);
}



function render() {
  updatePosition();

  // frustumTest();

  updateFrustum();

  prepareTiles();

  const threadsInTile = d.vec2u((width) / tiles.y, (height / tiles.x));
  for (let y = 0; y < tiles.y; y++) {
    for (let x = 0; x < tiles.x; x++) {
      currentTileUniform.write(d.vec2u(x, y));

      tilePipeline.
        with(mainBindGroup).
        dispatchThreads(threadsInTile.x, threadsInTile.y);
    }
  }

  pipeline.
    withColorAttachment({ view: context }).
    draw(3);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
