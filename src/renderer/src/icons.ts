import type { AddonView } from '../../shared/types'

// Icon names are WoW game icons served by Wowhead's CDN.
// Rules are checked in order against the addon's name, folder, repo and description;
// the first match wins. Anything unmatched gets a stable pick from FALLBACKS.
const RULES: [RegExp, string][] = [
  [/damage|dps|meter|recount|skada|details|combat log|parser/i, 'ability_warrior_endlessrage'],
  [/\bboss|encounter|\bdbm\b|bigwigs|deadly|\btimers?\b|alert|warning/i, 'achievement_boss_ragnaros'],
  [/threat|tank|aggro|taunt/i, 'ability_warrior_defensivestance'],
  [/heal|cleric|restoration|clique|click.?cast/i, 'spell_holy_flashheal'],
  [/bag|inventory|bank|baganator|bagnon|syndicator|sort|stash|warehouse/i, 'inv_misc_bag_08'],
  [/auction|gold|money|price|vendor|currency|trade|market|auctionator|tsm/i, 'inv_misc_coin_02'],
  [/\bmap|quest|minimap|waypoint|travel|\broute|\bzone|herebedragons/i, 'inv_misc_map_01'],
  [/aura|buff|debuff|weakaura|cooldown|\bprocs?\b|tracker|\bicons?\b/i, 'spell_nature_lightning'],
  [/nameplate|plater|unit ?frame|raid ?frame|health ?bar|castbar|plates/i, 'inv_misc_head_dragon_01'],
  [/chat|whisper|message|social|friend|guild|channel|emote|prat|glass/i, 'inv_letter_15'],
  [/tooltip|inspect|\bgear|item ?level|equip|character|paperdoll|\bstats?\b/i, 'inv_misc_spyglass_02'],
  [/mythic|keystone|dungeon|m\+|challenge|affix|group finder|lfg|instance/i, 'achievement_challengemode_gold'],
  [/pvp|arena|battleground|honor|duel/i, 'achievement_arena_2v2_1'],
  [/\bmounts?\b|\bpets?\b|collect|transmog|appearance|\btoys?\b|wardrobe|battle ?pet/i, 'ability_mount_ridinghorse'],
  [/profession|craft|recipe|enchant|gather|herb|mining|engineer|tradeskill/i, 'inv_misc_gear_01'],
  [/talent|\bspec|\bbuild|loadout|\bclass|rotation|spellbook|hekili/i, 'inv_misc_book_09'],
  [/achievement|progress|reputation|renown|collection/i, 'achievement_general'],
  [/sound|audio|music|voice|volume/i, 'inv_misc_horn_01'],
  [/macro|keybind|\bbinds?\b|\bbars?\b|action ?bar|bartender|dominos|\bbutton/i, 'inv_misc_key_03'],
  [/elvui|\bui\b|interface|layout|\bskin|theme|\bfonts?\b|texture|\bmedia\b|edit ?mode|frame/i, 'inv_misc_gem_diamond_02'],
  [/\blib|\bapi\b|\bace\d?\b|framework|\bcore\b|shared|embed|compat/i, 'inv_misc_rune_01'],
  [/weakauras|plugin|module|addon|manager|options|config|setting/i, 'trade_engineering']
]

const FALLBACKS = [
  'inv_misc_book_09',
  'inv_misc_gem_01',
  'inv_misc_rune_06',
  'inv_misc_orb_01',
  'spell_arcane_arcane01',
  'inv_misc_eye_01',
  'inv_scroll_03',
  'inv_misc_toy_02',
  'spell_holy_magicalsentry',
  'inv_misc_questionmark'
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Icon assigned by what the addon is (ignores any icon set in the .toc). */
export function assignedIcon(a: AddonView): string {
  // What the addon is called is a stronger signal than what its description mentions.
  const byName = `${a.name} ${a.folder} ${a.repo ?? ''}`
  for (const [re, icon] of RULES) if (re.test(byName)) return icon
  for (const [re, icon] of RULES) if (re.test(a.notes)) return icon
  return FALLBACKS[hash(a.folder.toLowerCase()) % FALLBACKS.length]
}

/** Icons to try in order: the author's own WoW icon (if the .toc sets one), then ours. */
export function iconCandidates(a: AddonView): string[] {
  return [...new Set([...(a.wowIcon ? [a.wowIcon] : []), assignedIcon(a)])]
}
