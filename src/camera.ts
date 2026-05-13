import { d, std } from "typegpu";
import * as m from 'wgpu-matrix';

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

export function setupFirstPersonCamera(
    canvas: HTMLCanvasElement,
    partialOptions: CameraOptions,
    callback: (updatedProps: Partial<d.Infer<typeof Camera>>) => void,
) {
    const options = { ...cameraDefaults, ...partialOptions } as Required<CameraOptions>;

    // `runCallback` creates a Camera object based on the `cameraState` and passes it to the callback
    const cameraState = {
        position: options.initPos,
        yaw: 0,
        pitch: 0,
        mouse: d.vec2f(0, 0),
        frustum: d.arrayOf(d.vec4f, 6)(),
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

        updateFrustum();

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
        cameraState.frustum = frustumFromViewProjection(viewProj);
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

export function calculateProj(aspectRatio: number, fov: number = Math.PI / 2, near: number = 0.001, far: number = 1000) {
    return m.mat4.perspective(fov, aspectRatio, near, far, d.mat4x4f());
}

function invertMat(matrix: d.m4x4f) {
    return m.mat4.invert(matrix, d.mat4x4f());
}

export function frustumFromViewProjection(viewProj: d.m4x4f) {
    // Matrix is column-major in wgpu-matrix
    // Row 0: m[0], m[4], m[8], m[12]
    // Row 1: m[1], m[5], m[9], m[13]
    // Row 2: m[2], m[6], m[10], m[14]
    // Row 3: m[3], m[7], m[11], m[15]

    // Left plane: row3 + row0
    const left = normalizePlane(
        viewProj[3] + viewProj[0],
        viewProj[7] + viewProj[4],
        viewProj[11] + viewProj[8],
        viewProj[15] + viewProj[12],
    );

    // Right plane: row3 - row0
    const right = normalizePlane(
        viewProj[3] - viewProj[0],
        viewProj[7] - viewProj[4],
        viewProj[11] - viewProj[8],
        viewProj[15] - viewProj[12],
    );

    // Bottom plane: row3 + row1
    const bottom = normalizePlane(
        viewProj[3] + viewProj[1],
        viewProj[7] + viewProj[5],
        viewProj[11] + viewProj[9],
        viewProj[15] + viewProj[13],
    );

    // Top plane: row3 - row1
    const top = normalizePlane(
        viewProj[3] - viewProj[1],
        viewProj[7] - viewProj[5],
        viewProj[11] - viewProj[9],
        viewProj[15] - viewProj[13],
    );

    // Near plane: row3 + row2
    const near = normalizePlane(
        viewProj[3] + viewProj[2],
        viewProj[7] + viewProj[6],
        viewProj[11] + viewProj[10],
        viewProj[15] + viewProj[14],
    );

    // Far plane: row3 - row2
    const far = normalizePlane(
        viewProj[3] - viewProj[2],
        viewProj[7] - viewProj[6],
        viewProj[11] - viewProj[10],
        viewProj[15] - viewProj[14],
    );

    return [
        left,
        right,
        bottom,
        top,
        near,
        far
    ];
}

function createPlane(normal: d.v3f, distance: number) {
    return d.vec4f(normal, distance);
}

function normalizePlane(a: number, b: number, c: number, dd: number) {
    const len = Math.sqrt(a * a + b * b + c * c);
    if (len === 0) {
        return createPlane(d.vec3f(0, 0, 0), 0);
    }
    return createPlane(d.vec3f(a / len, b / len, c / len), dd / len);
}