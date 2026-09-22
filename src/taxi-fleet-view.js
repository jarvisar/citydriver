import { CARS } from './cars.js';
import { carArt } from './car-art.js';
import { TAXI_FLEET } from './taxi-fleet.js';

export const fleetMoney = amount => `$${amount.toLocaleString('en-US')}`;

export function setupTaxiFleet(fleet, { running, onChange }) {
  const dialog = document.querySelector('#taxi-fleet-dialog');
  const cards = dialog.querySelector('.taxi-fleet-cards');
  function render() {
    dialog.querySelector('#fleet-balance').textContent = fleetMoney(fleet.balance);
    dialog.querySelector('#fleet-note').textContent = running()
      ? 'Your current cab stays on this run. Selections apply to your next run.'
      : 'Buy once, keep forever. Every completed fare banks cash, even if you leave a run.';
    dialog.querySelector('#fleet-save').hidden = fleet.saved;
    cards.innerHTML = TAXI_FLEET.map(({ id, price, title, description }, index) => {
      const entry = CARS[id], owned = fleet.owned.has(id), selected = fleet.selected === id;
      const short = Math.max(0, price - fleet.balance);
      const action = selected ? 'Selected for next run' : owned ? 'Select cab' : `Buy & select · ${fleetMoney(price)}`;
      const stats = [['Top speed', `${Math.round(entry.stats.topSpeed * 2.23694)} mph`, entry.stats.topSpeed / 55],
        ['Acceleration', `${entry.stats.acceleration} m/s²`, entry.stats.acceleration / 42],
        ['Handling', `${entry.stats.grip.toFixed(2)}×`, entry.stats.grip / 1.8],
        ['Braking', `${entry.stats.braking} m/s²`, entry.stats.braking / 38]];
      return `<article class="taxi-fleet-card" data-selected="${selected}" style="--car-paint:${entry.paint}">
        <div class="fleet-card-top"><span>0${index + 1} / ${title}</span><span>${selected ? 'SELECTED' : owned ? 'OWNED' : fleetMoney(price)}</span></div>
        ${carArt(id)}<h3>${entry.name}</h3><p class="fleet-description">${description}</p>
        <dl class="fleet-stats">${stats.map(([label, value, level]) => `<div><dt>${label}</dt><dd>${value}</dd><span aria-hidden="true"><i style="width:${level * 100}%"></i></span></div>`).join('')}</dl>
        <p class="fleet-progress">${owned ? index === 0 ? 'Included with your fleet' : 'Yours for every taxi run' : short ? `${fleetMoney(short)} to go` : 'Ready for an upgrade'}</p>
        ${!owned ? `<progress max="${price}" value="${Math.min(price, fleet.balance)}" aria-label="Savings toward ${entry.name}"></progress>` : ''}
        <button type="button" data-fleet-car="${id}" aria-label="${entry.name}: ${action}" aria-pressed="${selected}" ${!owned && short ? 'disabled' : ''}>${action}</button>
      </article>`;
    }).join('');
    document.querySelector('#taxi-result-bank').textContent = `Fleet balance ${fleetMoney(fleet.balance)} · Fares banked as you drive`;
  }
  cards.addEventListener('click', event => {
    const button = event.target.closest('[data-fleet-car]');
    if (!button) return;
    const id = button.dataset.fleetCar;
    const owned = fleet.owned.has(id);
    if (!(owned ? fleet.select(id) : fleet.buy(id))) return;
    render();
    dialog.querySelector('#fleet-feedback').textContent = `${CARS[id].name} ${owned ? 'selected' : 'purchased'} for your next run.`;
    cards.querySelector(`[data-fleet-car="${id}"]`).focus();
    onChange();
  });
  render();
  return { render };
}
