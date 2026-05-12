import { d, std } from "typegpu";
import * as m from 'wgpu-matrix';

export const Camera = d.struct({
    position: d.vec3f,
    rotation: d.mat4x4f,
    mouse: d.vec2f
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
    };

    function runCallback() {
        const position = cameraState.position;
        const pitch = cameraState.pitch;
        const yaw = cameraState.yaw;
        const mouse = cameraState.mouse;

        const rotation = m.mat4.rotationY(yaw, d.mat4x4f()).mul(m.mat4.rotationX(pitch, d.mat4x4f()));

        callback(
            Camera({
                position,
                rotation,
                mouse
            }),
        );
    }

    function rotateCamera(dx: number, dy: number) {
        cameraState.yaw += dx * options.orbitSensitivity;
        cameraState.pitch -= dy * options.orbitSensitivity;
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
            cameraState.position = cameraState.position.sub(left);
        }
        if (pressedKeys.has('d')) {
            cameraState.position = cameraState.position.add(left);
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
    return { state: cameraState, updatePosition, cleanupCamera };
}