// The title to give a cemetery's plot-map Space page, e.g. "Fern Hill Cemetery Aberdeen WA USA Plot Map Table".
// Titles are written the way you type them into WikiTree's new-page box: spaces, no "Space:" prefix.
import { canonSpaceTitle } from './spacetable.js';

const US = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
const CA = {
  Alberta: 'AB', 'British Columbia': 'BC', Manitoba: 'MB', 'New Brunswick': 'NB', 'Newfoundland and Labrador': 'NL', 'Nova Scotia': 'NS',
  Ontario: 'ON', 'Prince Edward Island': 'PE', 'Québec': 'QC', Quebec: 'QC', Saskatchewan: 'SK',
};

/** "Aberdeen, Washington" -> "Aberdeen WA USA"; "Raton, Colfax County, New Mexico, USA" -> "Raton NM USA"; others are kept as written. */
export function placeWords(location) {
  const parts = String(location || '').split(',').map((p) => p.trim()).filter(Boolean);
  const out = [];
  let country = '';
  for (const p of parts) {
    if (/^(usa|united states( of america)?|u\.s\.a?\.?)$/i.test(p)) country = 'USA';
    else if (/^canada$/i.test(p)) country = 'Canada';
    else if (US[p]) { out.push(US[p]); country ||= 'USA'; }
    else if (CA[p]) { out.push(CA[p]); country ||= 'Canada'; }
    else if (!/ County$| Parish$/i.test(p)) out.push(p);
  }
  if (country) out.push(country);
  return out.join(' ');
}

/** "Fern Hill Cemetery" + "Aberdeen, Washington" -> "Fern Hill Cemetery Aberdeen WA USA Plot Map Table". */
export function suggestTableTitle(name, location) {
  const base = String(name || '').trim();
  if (!base) return '';
  return [base, placeWords(location), 'Plot Map Table'].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** What the user typed (a title, a "Space:" title or a wikitree.com link) -> the page key the app uses: "Space:Name_With_Underscores". */
export function tablePageFromInput(text) {
  let s = String(text || '').trim().replace(/^https?:\/\/(www\.)?wikitree\.com\/wiki\//i, '').replace(/^Space:/i, '').trim();
  if (!s) return '';
  return `Space:${canonSpaceTitle(s).replace(/_+/g, '_')}`;
}

/** The other way: "Space:Fern_Hill_Plot_Map_Table" -> "Fern Hill Plot Map Table". */
export function tableTitleOf(page) {
  return String(page || '').replace(/^Space:/i, '').replace(/_/g, ' ');
}
