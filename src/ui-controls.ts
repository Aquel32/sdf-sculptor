import { d } from "typegpu";
import { setDebugBoundings, setSmoothness, setTiles, smoothnessUniform } from "./main";

export function PrepareUI() {
    document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <canvas id="canvas" width="1920" height="1920"></canvas>

    <div>
    <label>Tiles X: <input id="tilesX" type="number" min="1" max="10" step="1" value="10"></label>
    <label>Tiles Y: <input id="tilesY" type="number" min="1" max="10" step="1" value="10"></label>
    <label>K: <input id="k" type="range" min="0.0001" max="2" step="0.01" value="0.0001"></label>
    <label>Debug Boundings: <input id="debugBoundings" type="checkbox"></label>
    </div>
    `;

    document.querySelectorAll<HTMLInputElement>("input").forEach(input => {
        input.addEventListener("input", () => {
            updateUniforms();
        });
    });

    function updateUniforms() {
        const k = parseFloat((document.querySelector<HTMLInputElement>("#k")!).value);
        const debugBoundings = (document.querySelector<HTMLInputElement>("#debugBoundings")!).checked;
        const debugBoundingsValue = debugBoundings ? 1 : 0;
        const tilesX = parseInt((document.querySelector<HTMLInputElement>("#tilesX")!).value);
        const tilesY = parseInt((document.querySelector<HTMLInputElement>("#tilesY")!).value);

        setTiles(tilesX, tilesY);
        setSmoothness(k);
        setDebugBoundings(debugBoundingsValue);
    }

    updateUniforms();
}