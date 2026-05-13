import { d } from "typegpu";
import { boxPositionUniform, debugBoundingsUniform, diskPositionUniform, smoothnessUniform } from "./main";

export function PrepareUI() {
    document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <canvas id="canvas" width="1920" height="1920"></canvas>

    <div>
    <label>Box X: <input id="boxX" type="range" min="-1" max="1" step="0.01" value="0"></label>
    <label>Box Y: <input id="boxY" type="range" min="-1" max="1" step="0.01" value="0"></label>

    <label>Disk X: <input id="diskX" type="range" min="-1" max="1" step="0.01" value="0"></label>
    <label>Disk Y: <input id="diskY" type="range" min="-1" max="1" step="0.01" value="0"></label>
    <label>K: <input id="k" type="range" min="0.0001" max="2" step="0.01" value="0.1"></label>
    <label>Debug Boundings: <input id="debugBoundings" type="checkbox"></label>
    </div>
    `;

    document.querySelectorAll<HTMLInputElement>("input").forEach(input => {
        input.addEventListener("input", () => {
            updateUniforms();
        });
    });

    function updateUniforms() {
        const boxX = parseFloat((document.querySelector<HTMLInputElement>("#boxX")!).value);
        const boxY = parseFloat((document.querySelector<HTMLInputElement>("#boxY")!).value);
        const diskX = parseFloat((document.querySelector<HTMLInputElement>("#diskX")!).value);
        const diskY = parseFloat((document.querySelector<HTMLInputElement>("#diskY")!).value);
        const k = parseFloat((document.querySelector<HTMLInputElement>("#k")!).value);
        const debugBoundings = (document.querySelector<HTMLInputElement>("#debugBoundings")!).checked;
        const debugBoundingsValue = debugBoundings ? 1 : 0;

        boxPositionUniform.write(d.vec3f(boxX, boxY, 0));
        diskPositionUniform.write(d.vec3f(diskX, diskY, 0));
        smoothnessUniform.write(k);
        debugBoundingsUniform.write(debugBoundingsValue);
    }

    updateUniforms();
}