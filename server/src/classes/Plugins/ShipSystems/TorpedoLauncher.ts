import type BasePlugin from "..";
import BaseShipSystemPlugin, { registerSystem } from "./BaseSystem";
import type { ShipSystemFlags } from "./shipSystemTypes";

// TODO March 16, 2022: Add the necessary sound effects
export default class TorpedoLauncherPlugin extends BaseShipSystemPlugin {
	static flags: ShipSystemFlags[] = ["efficiency", "heat", "power"];
	type = "torpedoLauncher" as const;
	allowMultiple = true;

	loadTime: number;
	fireTime: number;
	headingDegree: number;
	pitchDegree: number;

	constructor(params: Partial<TorpedoLauncherPlugin>, plugin: BasePlugin) {
		super(params, plugin);
		this.loadTime = params.loadTime ?? 5000;
		this.fireTime = params.fireTime ?? 1000;
		this.headingDegree = params.headingDegree ?? 0;
		this.pitchDegree = params.pitchDegree ?? 0;
	}
}
registerSystem("torpedoLauncher", TorpedoLauncherPlugin);
