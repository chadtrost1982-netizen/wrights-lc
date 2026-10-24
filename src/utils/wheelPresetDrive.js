import { createWheelPresetDrive, isGraphClientConfigured } from "./oneDriveGraph.js";
import { setWheelDriveFactory } from "./wheelPresets.js";

setWheelDriveFactory(() => {
  if (!isGraphClientConfigured()) return null;
  return createWheelPresetDrive();
});

export {
  loadSharedWheelBook,
  readCachedWheelBook,
  rememberWheelLines,
  saveSharedWheelBook,
  writeCachedWheelBook,
} from "./wheelPresets.js";
