export const FLEET_KEY = 'citydriver-taxi-fleet';
export const TAXI_FLEET = [
  { id: 'taxi', price: 0, title: 'The original', description: 'A dependable city cab. Plenty of pace to get your fleet started.' },
  { id: 'taxiGT', price: 1500, title: 'The fast lane', description: 'A sports coupe with quicker launches, sharper turns and stronger brakes.' },
  { id: 'taxiFormula', price: 4500, title: 'The ultimate fare', description: 'Two seats. Open wheels. Formula power with the best grip in the fleet.' },
];
const validMoney = value => Number.isSafeInteger(value) && value >= 0;

// One save for balance, ownership and selection keeps a purchase together.
// Completed fares bank immediately, including when a run is later abandoned.
export class TaxiFleet {
  constructor(storage = null) {
    this.storage = storage; this.balance = 0; this.owned = new Set(['taxi']); this.selected = 'taxi'; this.saved = Boolean(storage);
    try {
      const data = JSON.parse(storage?.getItem(FLEET_KEY) ?? 'null');
      if (data?.version === 1 && validMoney(data.balance)) {
        this.balance = data.balance;
        for (const cab of TAXI_FLEET) if (Array.isArray(data.owned) && data.owned.includes(cab.id)) this.owned.add(cab.id);
        if (this.owned.has(data.selected)) this.selected = data.selected;
      }
    } catch { /* Corrupt or unavailable storage starts a usable local fleet. */ }
  }
  save() {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(FLEET_KEY, JSON.stringify({ version: 1, balance: this.balance, owned: [...this.owned], selected: this.selected }));
      this.saved = true;
    } catch { this.saved = false; }
  }
  credit(amount) {
    if (!validMoney(amount) || !Number.isSafeInteger(this.balance + amount)) return false;
    this.balance += amount; this.save(); return true;
  }
  select(id) {
    if (!this.owned.has(id)) return false;
    this.selected = id; this.save(); return true;
  }
  buy(id) {
    const cab = TAXI_FLEET.find(cab => cab.id === id);
    if (!cab || this.owned.has(id) || this.balance < cab.price) return false;
    this.balance -= cab.price; this.owned.add(id); this.selected = id; this.save(); return true;
  }
}
