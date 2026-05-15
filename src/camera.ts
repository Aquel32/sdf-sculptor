import { d, std } from "typegpu";
import * as m from 'wgpu-matrix';
import { MAX_TILES } from "./main";

export const Camera = d.struct({
    position: d.vec3f,
    view: d.mat4x4f,
    inverseView: d.mat4x4f,
    projection: d.mat4x4f,
    inverseProjection: d.mat4x4f,
    mouse: d.vec2f,
});

export interface CameraOptions {
    initPos?: d.v3f;
    speed?: d.v3f;
    orbitSensitivity?: number;
}

const cameraDefaults: Partial<CameraOptions> = {
    initPos: d.vec3f(0, 0, 0),
    speed: d.vec3f(1, 1, 1),
};

type Corners = {
    topLeft: d.v3f;
    topRight: d.v3f;
    bottomRight: d.v3f;
    bottomLeft: d.v3f;
}
export function setupFirstPersonCamera(
    canvas: HTMLCanvasElement,
    partialOptions: CameraOptions,
    tiles: d.v2f,
    callback: (updatedProps: Partial<d.Infer<typeof Camera>>) => void,
) {
    const options = { ...cameraDefaults, ...partialOptions } as Required<CameraOptions>;

    // `runCallback` creates a Camera object based on the `cameraState` and passes it to the callback
    const cameraState = {
        position: options.initPos,
        yaw: 0,
        pitch: 0,
        mouse: d.vec2f(0, 0),
        frustum: d.arrayOf(d.arrayOf(d.arrayOf(d.vec4f, 6), MAX_TILES), MAX_TILES)(),
        view: d.mat4x4f(),
        projection: d.mat4x4f(),
    };

    function runCallback() {
        const position = cameraState.position;
        const pitch = cameraState.pitch;
        const yaw = cameraState.yaw;
        const mouse = cameraState.mouse;

        const target = position.add(
            d.vec3f(std.cos(pitch) * std.sin(yaw), std.sin(pitch), std.cos(pitch) * std.cos(yaw)),
        );

        const view = calculateView(position, target);
        const projection = calculateProj(canvas.clientWidth / canvas.clientHeight);

        cameraState.view = view;
        cameraState.projection = projection;

        // updateFrustum();

        callback(
            Camera({
                position,
                view,
                inverseView: invertMat(view),
                projection,
                inverseProjection: invertMat(projection),
                mouse,
            }),
        );
    }

    function updateFrustum() {
        const viewProj = cameraState.projection.mul(cameraState.view);
        const invViewProj = invertMat(viewProj);

        const { near, far } = getFrustumCorners(invViewProj);

        for (let x = 0; x < tiles.x; x++) {
            for (let y = 0; y < tiles.y; y++) {
                cameraState.frustum[x][y] = generateFrustumTile(d.f32(x), d.f32(y), near, far);
            }
        }
    }

    function generateFrustumTile(x: number, y: number, nearCorners: Corners, farCorners: Corners) {
        "use gpu";

        const x0 = x / tiles.x;
        const x1 = (x + 1) / tiles.x;
        const y0 = y / tiles.y;
        const y1 = (y + 1) / tiles.y;

        const nearBottomLeft = nearCorners.bottomLeft + (nearCorners.topLeft - nearCorners.bottomLeft).mul(y0);
        const nearBottomRight = nearCorners.bottomRight + (nearCorners.topRight - nearCorners.bottomRight).mul(y0);
        const nearTopLeft = nearCorners.bottomLeft + (nearCorners.topLeft - nearCorners.bottomLeft).mul(y1);
        const nearTopRight = nearCorners.bottomRight + (nearCorners.topRight - nearCorners.bottomRight).mul(y1);

        const farBottomLeft = farCorners.bottomLeft + (farCorners.topLeft - farCorners.bottomLeft).mul(y0);
        const farBottomRight = farCorners.bottomRight + (farCorners.topRight - farCorners.bottomRight).mul(y0);
        const farTopLeft = farCorners.bottomLeft + (farCorners.topLeft - farCorners.bottomLeft).mul(y1);
        const farTopRight = farCorners.bottomRight + (farCorners.topRight - farCorners.bottomRight).mul(y1);

        const nearNew: Corners = {
            bottomLeft: nearBottomLeft + (nearBottomRight - nearBottomLeft).mul(x0),
            bottomRight: nearBottomLeft + (nearBottomRight - nearBottomLeft).mul(x1),
            topLeft: nearTopLeft + (nearTopRight - nearTopLeft).mul(x0),
            topRight: nearTopLeft + (nearTopRight - nearTopLeft).mul(x1),
        };

        const farNew: Corners = {
            bottomLeft: farBottomLeft + (farBottomRight - farBottomLeft).mul(x0),
            bottomRight: farBottomLeft + (farBottomRight - farBottomLeft).mul(x1),
            topLeft: farTopLeft + (farTopRight - farTopLeft).mul(x0),
            topRight: farTopLeft + (farTopRight - farTopLeft).mul(x1),
        };

        return getFrustumPlanes(nearNew, farNew)
    }

    function rotateCamera(dx: number, dy: number) {
        cameraState.yaw -= dx * options.orbitSensitivity;
        cameraState.pitch += dy * options.orbitSensitivity;
        cameraState.pitch = std.clamp(cameraState.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

        runCallback();
    }

    function moveMouse(x: number, y: number) {
        "use gpu";

        const rect = canvas.getBoundingClientRect();
        const mouse = d.vec2f((x - rect.left) / rect.width, (y - rect.top) / rect.height);

        cameraState.mouse = mouse;

        runCallback();
    }

    // resize observer
    const resizeObserver = new ResizeObserver(() => {
        runCallback();
    });
    resizeObserver.observe(canvas);

    // Variables for interaction.
    const pressedKeys = new Set<string>();
    let moveSpeed = options.speed.y;

    // keyboard events
    const keyDownEventListener = (event: KeyboardEvent) => {
        pressedKeys.add(event.key.toLowerCase());
    };
    window.addEventListener("keydown", keyDownEventListener);

    const keyUpEventListener = (event: KeyboardEvent) => {
        pressedKeys.delete(event.key.toLowerCase());
    };
    window.addEventListener("keyup", keyUpEventListener);

    // mouse events
    canvas.addEventListener("mousedown", () => {
        void canvas.requestPointerLock();
    });

    canvas.addEventListener("mousemove", (event: MouseEvent) => {
        moveMouse(event.clientX, event.clientY);

        if (document.pointerLockElement !== canvas) {
            return;
        }
        const dx = event.movementX;
        const dy = event.movementY;

        rotateCamera(dx, dy);
        //rotate function
    });

    canvas.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            moveSpeed = std.clamp(moveSpeed * (1 - e.deltaY * 0.0005), options.speed.x, options.speed.z);
        },
        { passive: false },
    );

    function cleanupCamera() {
        window.removeEventListener('keydown', keyDownEventListener);
        window.removeEventListener('keyup', keyUpEventListener);
        resizeObserver.unobserve(canvas);
    }


    const updatePosition = () => {
        if (document.pointerLockElement !== canvas) {
            return;
        }

        const forward = std
            .normalize(d.vec3f(std.sin(cameraState.yaw), 0, std.cos(cameraState.yaw)))
            .mul(moveSpeed);
        const left = d.vec3f(forward.z, 0, -forward.x);

        if (pressedKeys.has('w')) {
            cameraState.position = cameraState.position.add(forward);
        }
        if (pressedKeys.has('s')) {
            cameraState.position = cameraState.position.sub(forward);
        }
        if (pressedKeys.has('a')) {
            cameraState.position = cameraState.position.add(left);
        }
        if (pressedKeys.has('d')) {
            cameraState.position = cameraState.position.sub(left);
        }
        if (pressedKeys.has('shift')) {
            cameraState.position.y += moveSpeed;
        }
        if (pressedKeys.has(' ')) {
            cameraState.position.y -= moveSpeed;
        }
        runCallback();
    };


    runCallback();
    return { state: cameraState, updatePosition, cleanupCamera, updateFrustum };
}

export function calculateView(position: d.v3f, target: d.v3f, up: d.v3f = d.vec3f(0, 1, 0)) {
    return m.mat4.lookAt(position, target, up, d.mat4x4f());
}

export function calculateProj(aspectRatio: number, fov: number = Math.PI / 2, near: number = 0.1, far: number = 1000) {
    return m.mat4.perspective(fov, aspectRatio, near, far, d.mat4x4f());
}

function invertMat(matrix: d.m4x4f) {
    return m.mat4.invert(matrix, d.mat4x4f());
}

function getFrustumCorners(invViewProj: d.m4x4f): { near: Corners; far: Corners } {
    const clipCorners = [
        // near plane, z = 0
        [-1, -1, 0, 1],
        [1, -1, 0, 1],
        [1, 1, 0, 1],
        [-1, 1, 0, 1],

        // far plane, z = 1
        [-1, -1, 1, 1],
        [1, -1, 1, 1],
        [1, 1, 1, 1],
        [-1, 1, 1, 1],
    ] as const;

    const corners = clipCorners.map((p) => {
        const world = m.vec4.transformMat4(p, invViewProj, d.vec4f());

        return d.vec3f(
            world[0] / world[3],
            world[1] / world[3],
            world[2] / world[3],
        );
    });

    return {
        near: {
            bottomLeft: corners[0],
            bottomRight: corners[1],
            topRight: corners[2],
            topLeft: corners[3],
        },
        far: {
            bottomLeft: corners[4],
            bottomRight: corners[5],
            topRight: corners[6],
            topLeft: corners[7],
        }
    };
}

function planeFromPoints(a: d.v3f, b: d.v3f, c: d.v3f) {
    "use gpu";

    const ab = b - a;
    const ac = c - a;

    const normal = std.normalize(std.cross(ab, ac));
    const distance = -std.dot(normal, a);

    return d.vec4f(normal, distance);
}

function getFrustumPlanes(near: Corners, far: Corners) {
    return [
        // near
        planeFromPoints(
            near.bottomLeft,
            near.topLeft,
            near.topRight,
        ),

        // far
        planeFromPoints(
            far.bottomRight,
            far.topRight,
            far.topLeft,
        ),

        // left
        planeFromPoints(
            far.bottomLeft,
            far.topLeft,
            near.topLeft,
        ),

        // right
        planeFromPoints(
            near.bottomRight,
            near.topRight,
            far.topRight,
        ),

        // top
        planeFromPoints(
            near.topLeft,
            far.topLeft,
            far.topRight,
        ),

        // bottom
        planeFromPoints(
            far.bottomLeft,
            near.bottomLeft,
            near.bottomRight,
        ),
    ];
}