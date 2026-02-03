// Pre-built attack database for canonical Digimon attacks - DDA 1.4 format
// Attacks require the Digimon to have the appropriate qualities for their tags
// Sources: Digimon Adventure, Adventure 02, Tamers anime

export interface AttackTemplate {
  id: string
  name: string
  range: 'melee' | 'ranged'
  type: 'damage' | 'support'
  tags: string[] // Quality-based tags - require owning the quality
  effect?: string // Requires effect quality
  description: string
  stage: 'any' | 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'
  digimon?: string // Which Digimon uses this attack
}

export const ATTACK_DATABASE: AttackTemplate[] = [
  // ==========================================
  // FRESH STAGE
  // ==========================================
  {
    id: 'bubble-blow',
    name: 'Bubble Blow',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Produces bubbles from its mouth to intimidate opponents.',
    stage: 'fresh',
    digimon: 'Botamon, Punimon, Poyomon, etc.',
  },

  // ==========================================
  // IN-TRAINING STAGE
  // ==========================================
  {
    id: 'bubble-blow-in-training',
    name: 'Bubble Blow',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Fires bubbles from its mouth.',
    stage: 'in-training',
    digimon: 'Koromon, Tsunomon, Tokomon, etc.',
  },

  // ==========================================
  // ROOKIE STAGE - Digimon Adventure
  // ==========================================
  // Agumon
  {
    id: 'pepper-breath',
    name: 'Pepper Breath',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Spits a ball of flame from its mouth.',
    stage: 'rookie',
    digimon: 'Agumon',
  },
  {
    id: 'claw-attack',
    name: 'Claw Attack',
    range: 'melee',
    type: 'damage',
    tags: [],
    description: 'Attacks with its claws.',
    stage: 'rookie',
    digimon: 'Agumon',
  },

  // Gabumon
  {
    id: 'blue-blaster',
    name: 'Blue Blaster',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Fires a stream of blue flames from its mouth.',
    stage: 'rookie',
    digimon: 'Gabumon',
  },
  {
    id: 'horn-attack',
    name: 'Horn Attack',
    range: 'melee',
    type: 'damage',
    tags: [],
    description: 'Attacks with its horn.',
    stage: 'rookie',
    digimon: 'Gabumon',
  },

  // Biyomon
  {
    id: 'spiral-twister',
    name: 'Spiral Twister',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Creates a spiraling flame that hits the opponent.',
    stage: 'rookie',
    digimon: 'Biyomon',
  },

  // Tentomon
  {
    id: 'super-shocker',
    name: 'Super Shocker',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Fires an electric bolt from its antennae.',
    stage: 'rookie',
    digimon: 'Tentomon',
  },

  // Palmon
  {
    id: 'poison-ivy',
    name: 'Poison Ivy',
    range: 'melee',
    type: 'damage',
    tags: [],
    effect: 'Poison',
    description: 'Entangles the enemy with poisonous vines.',
    stage: 'rookie',
    digimon: 'Palmon',
  },

  // Gomamon
  {
    id: 'marching-fishes',
    name: 'Marching Fishes',
    range: 'ranged',
    type: 'damage',
    tags: ['Area Attack: Burst'],
    description: 'Summons a school of fish to attack.',
    stage: 'rookie',
    digimon: 'Gomamon',
  },

  // Patamon
  {
    id: 'boom-bubble',
    name: 'Boom Bubble',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Shoots a ball of compressed air.',
    stage: 'rookie',
    digimon: 'Patamon',
  },

  // Gatomon (Rookie-level stats in Adventure)
  {
    id: 'lightning-paw',
    name: 'Lightning Paw',
    range: 'melee',
    type: 'damage',
    tags: ['Certain Strike I'],
    description: 'A lightning-fast punch.',
    stage: 'rookie',
    digimon: 'Gatomon',
  },
  {
    id: 'cats-eye-hypnotism',
    name: "Cat's Eye Hypnotism",
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Confuse',
    description: 'Hypnotizes the enemy with its eyes.',
    stage: 'rookie',
    digimon: 'Gatomon',
  },

  // Veemon (Adventure 02)
  {
    id: 'vee-headbutt',
    name: 'Vee Headbutt',
    range: 'melee',
    type: 'damage',
    tags: ['Charge Attack'],
    description: 'A powerful headbutt attack.',
    stage: 'rookie',
    digimon: 'Veemon',
  },

  // Wormmon
  {
    id: 'sticky-net',
    name: 'Sticky Net',
    range: 'ranged',
    type: 'damage',
    tags: [],
    effect: 'Immobilize',
    description: 'Shoots a net of sticky threads.',
    stage: 'rookie',
    digimon: 'Wormmon',
  },

  // Guilmon (Tamers)
  {
    id: 'pyro-sphere',
    name: 'Pyro Sphere',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Spits a concentrated ball of fire.',
    stage: 'rookie',
    digimon: 'Guilmon',
  },
  {
    id: 'rock-breaker',
    name: 'Rock Breaker',
    range: 'melee',
    type: 'damage',
    tags: ['Armor Piercing I'],
    description: 'A powerful claw strike that can break rocks.',
    stage: 'rookie',
    digimon: 'Guilmon',
  },

  // Terriermon
  {
    id: 'bunny-blast',
    name: 'Bunny Blast',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'Fires a ball of green energy.',
    stage: 'rookie',
    digimon: 'Terriermon',
  },
  {
    id: 'terrier-tornado',
    name: 'Terrier Tornado',
    range: 'melee',
    type: 'damage',
    tags: ['Area Attack: Burst'],
    description: 'Spins like a tornado, striking all nearby.',
    stage: 'rookie',
    digimon: 'Terriermon',
  },

  // Renamon
  {
    id: 'diamond-storm',
    name: 'Diamond Storm',
    range: 'ranged',
    type: 'damage',
    tags: ['Area Attack: Cone'],
    description: 'Summons a storm of razor-sharp shards.',
    stage: 'rookie',
    digimon: 'Renamon',
  },

  // ==========================================
  // CHAMPION STAGE - Digimon Adventure
  // ==========================================
  // Greymon
  {
    id: 'nova-blast',
    name: 'Nova Blast',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II'],
    description: 'Fires a massive ball of fire from its mouth.',
    stage: 'champion',
    digimon: 'Greymon',
  },
  {
    id: 'great-horns-attack',
    name: 'Great Horns Attack',
    range: 'melee',
    type: 'damage',
    tags: ['Charge Attack'],
    description: 'Charges and rams with its horns.',
    stage: 'champion',
    digimon: 'Greymon',
  },

  // Garurumon
  {
    id: 'howling-blaster',
    name: 'Howling Blaster',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II'],
    description: 'Fires a powerful stream of blue flames.',
    stage: 'champion',
    digimon: 'Garurumon',
  },

  // Birdramon
  {
    id: 'meteor-wing',
    name: 'Meteor Wing',
    range: 'ranged',
    type: 'damage',
    tags: ['Area Attack: Blast'],
    description: 'Rains down fireballs from its wings.',
    stage: 'champion',
    digimon: 'Birdramon',
  },

  // Kabuterimon
  {
    id: 'electro-shocker',
    name: 'Electro Shocker',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II'],
    effect: 'Stun',
    description: 'Fires a ball of electrical energy.',
    stage: 'champion',
    digimon: 'Kabuterimon',
  },

  // Togemon
  {
    id: 'needle-spray',
    name: 'Needle Spray',
    range: 'ranged',
    type: 'damage',
    tags: ['Area Attack: Cone'],
    description: 'Shoots countless needles from its body.',
    stage: 'champion',
    digimon: 'Togemon',
  },
  {
    id: 'lightspeed-jabbing',
    name: 'Lightspeed Jabbing',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon II', 'Certain Strike I'],
    description: 'Rapid-fire punches.',
    stage: 'champion',
    digimon: 'Togemon',
  },

  // Ikkakumon
  {
    id: 'harpoon-torpedo',
    name: 'Harpoon Torpedo',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II'],
    description: 'Fires its horn like a torpedo.',
    stage: 'champion',
    digimon: 'Ikkakumon',
  },

  // Angemon
  {
    id: 'hand-of-fate',
    name: 'Hand of Fate',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II', 'Armor Piercing I'],
    description: 'Fires a beam of holy energy from its fist.',
    stage: 'champion',
    digimon: 'Angemon',
  },
  {
    id: 'angel-rod',
    name: 'Angel Rod',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon II'],
    description: 'Strikes with its holy staff.',
    stage: 'champion',
    digimon: 'Angemon',
  },

  // ExVeemon (Adventure 02)
  {
    id: 'vee-laser',
    name: 'Vee Laser',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II'],
    description: 'Fires an X-shaped laser from its chest.',
    stage: 'champion',
    digimon: 'ExVeemon',
  },

  // Stingmon
  {
    id: 'spiking-strike',
    name: 'Spiking Strike',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon II', 'Armor Piercing I'],
    description: 'Stabs with its spikes.',
    stage: 'champion',
    digimon: 'Stingmon',
  },

  // Growlmon (Tamers)
  {
    id: 'pyro-blaster',
    name: 'Pyro Blaster',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II'],
    description: 'Fires a powerful stream of flames.',
    stage: 'champion',
    digimon: 'Growlmon',
  },
  {
    id: 'dragon-slash',
    name: 'Dragon Slash',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon II', 'Armor Piercing I'],
    description: 'Slashes with its arm blades.',
    stage: 'champion',
    digimon: 'Growlmon',
  },

  // Gargomon
  {
    id: 'gargo-laser',
    name: 'Gargo Laser',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II', 'Ammo'],
    description: 'Fires a barrage of bullets from its gatling arms.',
    stage: 'champion',
    digimon: 'Gargomon',
  },

  // Kyubimon
  {
    id: 'fox-tail-inferno',
    name: 'Fox Tail Inferno',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II', 'Area Attack: Cone'],
    description: 'Launches fireballs from its tails.',
    stage: 'champion',
    digimon: 'Kyubimon',
  },
  {
    id: 'dragon-wheel',
    name: 'Dragon Wheel',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon II', 'Charge Attack'],
    description: 'Engulfs itself in blue flames and charges.',
    stage: 'champion',
    digimon: 'Kyubimon',
  },

  // ==========================================
  // ULTIMATE STAGE - Digimon Adventure
  // ==========================================
  // MetalGreymon
  {
    id: 'giga-blaster',
    name: 'Giga Blaster',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Blast'],
    description: 'Fires organic missiles from its chest.',
    stage: 'ultimate',
    digimon: 'MetalGreymon',
  },
  {
    id: 'mega-claw',
    name: 'Mega Claw',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing II'],
    description: 'Extends its metal claw to slash.',
    stage: 'ultimate',
    digimon: 'MetalGreymon',
  },

  // WereGarurumon
  {
    id: 'wolf-claw',
    name: 'Wolf Claw',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Certain Strike II'],
    description: 'Slashes with razor-sharp claws.',
    stage: 'ultimate',
    digimon: 'WereGarurumon',
  },
  {
    id: 'garuru-kick',
    name: 'Garuru Kick',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Charge Attack'],
    description: 'A powerful flying kick.',
    stage: 'ultimate',
    digimon: 'WereGarurumon',
  },

  // Garudamon
  {
    id: 'wing-blade',
    name: 'Wing Blade',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Line'],
    description: 'Fires a blade of flame from its wings.',
    stage: 'ultimate',
    digimon: 'Garudamon',
  },

  // MegaKabuterimon
  {
    id: 'horn-buster',
    name: 'Horn Buster',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III'],
    effect: 'Stun',
    description: 'Fires electrical energy from its horn.',
    stage: 'ultimate',
    digimon: 'MegaKabuterimon',
  },

  // Lillymon
  {
    id: 'flower-cannon',
    name: 'Flower Cannon',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing I'],
    description: 'Fires energy from its flower hands.',
    stage: 'ultimate',
    digimon: 'Lillymon',
  },

  // Zudomon
  {
    id: 'vulcans-hammer',
    name: "Vulcan's Hammer",
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing II'],
    description: 'Strikes with its powerful hammer.',
    stage: 'ultimate',
    digimon: 'Zudomon',
  },

  // MagnaAngemon
  {
    id: 'gate-of-destiny',
    name: 'Gate of Destiny',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Signature Move'],
    description: 'Opens a portal that sucks in and destroys enemies.',
    stage: 'ultimate',
    digimon: 'MagnaAngemon',
  },
  {
    id: 'excalibur',
    name: 'Excalibur',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing II'],
    description: 'Extends a blade of holy energy from its arm.',
    stage: 'ultimate',
    digimon: 'MagnaAngemon',
  },

  // Angewomon
  {
    id: 'celestial-arrow',
    name: 'Celestial Arrow',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Certain Strike II'],
    description: 'Fires an arrow of holy light.',
    stage: 'ultimate',
    digimon: 'Angewomon',
  },
  {
    id: 'heavens-charm',
    name: "Heaven's Charm",
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Cleanse',
    description: 'Creates a cross of holy energy that purifies.',
    stage: 'ultimate',
    digimon: 'Angewomon',
  },

  // Paildramon (Adventure 02)
  {
    id: 'desperado-blaster',
    name: 'Desperado Blaster',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Ammo'],
    description: 'Rapid-fires energy bullets from hip guns.',
    stage: 'ultimate',
    digimon: 'Paildramon',
  },

  // WarGrowlmon (Tamers)
  {
    id: 'atomic-blaster',
    name: 'Atomic Blaster',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Line'],
    description: 'Fires beams from the cannons on its chest.',
    stage: 'ultimate',
    digimon: 'WarGrowlmon',
  },
  {
    id: 'radiation-blade',
    name: 'Radiation Blade',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing II'],
    description: 'Extends energy blades from its arms.',
    stage: 'ultimate',
    digimon: 'WarGrowlmon',
  },

  // Rapidmon
  {
    id: 'rapid-fire',
    name: 'Rapid Fire',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Ammo'],
    description: 'Fires homing missiles from its arms.',
    stage: 'ultimate',
    digimon: 'Rapidmon',
  },
  {
    id: 'tri-beam',
    name: 'Tri-Beam',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Cone'],
    description: 'Fires a triangular beam of energy.',
    stage: 'ultimate',
    digimon: 'Rapidmon',
  },

  // Taomon
  {
    id: 'talisman-of-light',
    name: 'Talisman of Light',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing II'],
    description: 'Throws a massive calligraphy brush.',
    stage: 'ultimate',
    digimon: 'Taomon',
  },

  // ==========================================
  // MEGA STAGE - Digimon Adventure
  // ==========================================
  // WarGreymon
  {
    id: 'terra-force',
    name: 'Terra Force',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon VII', 'Signature Move', 'Area Attack: Blast'],
    description: 'Gathers energy to form a massive sphere and hurls it.',
    stage: 'mega',
    digimon: 'WarGreymon',
  },
  {
    id: 'great-tornado',
    name: 'Great Tornado',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Charge Attack', 'Area Attack: Pass'],
    description: 'Spins rapidly and charges through enemies.',
    stage: 'mega',
    digimon: 'WarGreymon',
  },
  {
    id: 'dramon-killer',
    name: 'Dramon Killer',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing III'],
    description: 'Slashes with its Dramon Destroyer gauntlets.',
    stage: 'mega',
    digimon: 'WarGreymon',
  },

  // MetalGarurumon
  {
    id: 'metal-wolf-claw',
    name: 'Metal Wolf Claw',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Cone'],
    description: 'Fires a freezing blast from its mouth.',
    stage: 'mega',
    digimon: 'MetalGarurumon',
  },
  {
    id: 'ice-wolf-bite',
    name: 'Ice Wolf Bite',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Ammo'],
    description: 'Fires missiles from all over its body.',
    stage: 'mega',
    digimon: 'MetalGarurumon',
  },
  {
    id: 'garuru-tomahawk',
    name: 'Garuru Tomahawk',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Certain Strike II'],
    description: 'Slashes with its claws.',
    stage: 'mega',
    digimon: 'MetalGarurumon',
  },

  // Phoenixmon
  {
    id: 'crimson-flame',
    name: 'Crimson Flame',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Cone'],
    description: 'Breathes holy flames.',
    stage: 'mega',
    digimon: 'Phoenixmon',
  },
  {
    id: 'starlight-explosion',
    name: 'Starlight Explosion',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Signature Move', 'Area Attack: Burst'],
    description: 'Releases golden light that purifies all evil.',
    stage: 'mega',
    digimon: 'Phoenixmon',
  },

  // HerculesKabuterimon
  {
    id: 'giga-blaster-hk',
    name: 'Giga Blaster',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Blast'],
    effect: 'Stun',
    description: 'Fires a massive ball of electricity.',
    stage: 'mega',
    digimon: 'HerculesKabuterimon',
  },

  // Seraphimon
  {
    id: 'strike-of-the-seven-stars',
    name: 'Strike of the Seven Stars',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Signature Move', 'Armor Piercing III'],
    description: 'Creates seven orbs of holy energy that strike.',
    stage: 'mega',
    digimon: 'Seraphimon',
  },
  {
    id: 'seven-heavens',
    name: 'Seven Heavens',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Blast'],
    description: 'Fires seven balls of holy light.',
    stage: 'mega',
    digimon: 'Seraphimon',
  },

  // Imperialdramon (Adventure 02)
  {
    id: 'positron-laser',
    name: 'Positron Laser',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Line'],
    description: 'Fires a devastating beam from its cannon.',
    stage: 'mega',
    digimon: 'Imperialdramon',
  },
  {
    id: 'mega-crusher',
    name: 'Mega Crusher',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing III'],
    description: 'Crushes enemies with its massive claws.',
    stage: 'mega',
    digimon: 'Imperialdramon',
  },

  // Omnimon/Omegamon
  {
    id: 'supreme-cannon',
    name: 'Supreme Cannon',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Signature Move', 'Area Attack: Line'],
    description: 'Fires a freezing blast from the MetalGarurumon head.',
    stage: 'mega',
    digimon: 'Omnimon',
  },
  {
    id: 'transcendent-sword',
    name: 'Transcendent Sword',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing IV'],
    description: 'Slashes with the Grey Sword extending from its arm.',
    stage: 'mega',
    digimon: 'Omnimon',
  },

  // Gallantmon (Tamers)
  {
    id: 'lightning-joust',
    name: 'Lightning Joust',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Charge Attack', 'Armor Piercing III'],
    description: 'Thrusts with its Gram lance at high speed.',
    stage: 'mega',
    digimon: 'Gallantmon',
  },
  {
    id: 'shield-of-the-just',
    name: 'Shield of the Just',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Signature Move', 'Area Attack: Cone'],
    description: 'Fires a beam from its Aegis shield.',
    stage: 'mega',
    digimon: 'Gallantmon',
  },

  // MegaGargomon
  {
    id: 'mega-barrage',
    name: 'Mega Barrage',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Ammo', 'Area Attack: Blast'],
    description: 'Fires all weapons simultaneously.',
    stage: 'mega',
    digimon: 'MegaGargomon',
  },
  {
    id: 'gargo-missiles',
    name: 'Gargo Missiles',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Blast'],
    description: 'Launches missiles from its shoulders.',
    stage: 'mega',
    digimon: 'MegaGargomon',
  },

  // Sakuyamon
  {
    id: 'spirit-strike',
    name: 'Spirit Strike',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Certain Strike II'],
    description: 'Attacks with four fox spirits.',
    stage: 'mega',
    digimon: 'Sakuyamon',
  },
  {
    id: 'amethyst-mandala',
    name: 'Amethyst Mandala',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Burst'],
    description: 'Creates a barrier of golden rings that explode outward.',
    stage: 'mega',
    digimon: 'Sakuyamon',
  },

  // Beelzemon
  {
    id: 'double-impact',
    name: 'Double Impact',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Ammo', 'Certain Strike II'],
    description: 'Rapid-fires with its shotguns.',
    stage: 'mega',
    digimon: 'Beelzemon',
  },
  {
    id: 'darkness-claw',
    name: 'Darkness Claw',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Armor Piercing II'],
    description: 'Slashes with claws infused with dark power.',
    stage: 'mega',
    digimon: 'Beelzemon',
  },

  // ==========================================
  // UNIVERSAL ATTACKS (any stage)
  // ==========================================
  {
    id: 'basic-attack',
    name: 'Basic Attack',
    range: 'melee',
    type: 'damage',
    tags: [],
    description: 'A standard physical attack.',
    stage: 'any',
  },
  {
    id: 'basic-ranged',
    name: 'Basic Ranged Attack',
    range: 'ranged',
    type: 'damage',
    tags: [],
    description: 'A basic ranged attack.',
    stage: 'any',
  },
]

// Get attacks by stage (includes 'any' stage attacks)
export function getAttacksForStage(stage: string): AttackTemplate[] {
  return ATTACK_DATABASE.filter((a) => a.stage === stage || a.stage === 'any')
}

// Get all unique tags
export function getAllTags(): string[] {
  const tags = new Set<string>()
  ATTACK_DATABASE.forEach((a) => a.tags.forEach((t) => tags.add(t)))
  return Array.from(tags).sort()
}

// Search attacks
export function searchAttacks(query: string): AttackTemplate[] {
  const lower = query.toLowerCase()
  return ATTACK_DATABASE.filter(
    (a) =>
      a.name.toLowerCase().includes(lower) ||
      a.description.toLowerCase().includes(lower) ||
      a.tags.some((t) => t.toLowerCase().includes(lower)) ||
      (a.digimon && a.digimon.toLowerCase().includes(lower))
  )
}
