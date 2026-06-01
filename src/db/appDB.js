import Dexie from "dexie";

export const appDB = new Dexie("wrightsLC");
appDB.version(1).stores({
  quotes: "++id, customer, preset, mods, totals, description, date"
});
appDB.version(2).stores({
  quotes: "++id, customer, container, preset, mods, totals, deliveryDetails, notes, date",
});
