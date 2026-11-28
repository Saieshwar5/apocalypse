import { ENDINGS, PEOPLE, ROLE, weakestDuty, type Duty } from '../logic/mission';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * The "Your mission" help page: who the pilot is, the five things in their
 * care (with how each stands in this run), the people on the radio and how
 * a run ends.
 */
export function renderMission(root: HTMLElement, duties: readonly Duty[]): void {
  const role = element('div', 'mission-role');
  ROLE.forEach((text) => role.append(element('p', '', text)));

  const weakest = weakestDuty(duties);
  const list = element('div', 'mission-duties');
  for (const duty of duties) {
    const row = element('article', 'mission-duty');
    if (duty.reading) {
      row.dataset.state = duty.reading.state;
    }
    const head = element('header', '');
    head.append(element('h4', '', duty.title));
    if (duty.reading) {
      head.append(element('span', 'mission-reading', duty.id === weakest ? `${duty.reading.text} · needs you now` : duty.reading.text));
    }
    const facts = element('dl', '');
    facts.append(element('dt', '', 'Why'), element('dd', '', duty.why));
    facts.append(element('dt', '', 'Your work'), element('dd', '', duty.how));
    facts.append(element('dt', '', 'If it slips'), element('dd', '', duty.cost));
    row.append(head, facts);
    list.append(row);
  }

  const people = element('div', '');
  people.append(element('h3', '', 'The people on the radio'));
  const cast = element('dl', 'mission-people');
  for (const person of PEOPLE) {
    cast.append(element('dt', '', person.name), element('dd', '', person.role));
  }
  people.append(cast);

  const endings = element('div', '');
  endings.append(element('h3', '', 'How a run ends'));
  const ends = element('dl', 'mission-endings');
  for (const ending of ENDINGS) {
    const title = element('dt', '', ending.title);
    title.dataset.win = String(ending.win);
    ends.append(title, element('dd', '', ending.text));
  }
  endings.append(ends);

  const foot = element('div', 'help-columns mission-foot');
  foot.append(people, endings);

  root.replaceChildren(role, element('h3', '', 'Five things in your care'), list, foot);
}
