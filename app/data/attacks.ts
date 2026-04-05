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
  // ROOKIE STAGE
  // ==========================================
  // Agumon
  {
    id: 'pepper-breath',
    name: 'Pepper Breath',
    range: 'ranged',
    type: 'damage',
    tags: [],
    effect: 'Burn',
    description: 'Spits a ball of flame from its mouth that scorches the target.',
    stage: 'rookie',
    digimon: 'Agumon',
  },
  {
    id: 'claw-attack',
    name: 'Claw Attack',
    range: 'melee',
    type: 'damage',
    tags: [],
    effect: 'Blind',
    description: 'Rakes with its claws, kicking up dust and debris that blinds the target.',
    stage: 'rookie',
    digimon: 'Agumon',
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

  // Gatomon
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
    tags: ['Weapon I'],
    description: 'Fires a focused ball of green energy.',
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

  // Salamon
  {
    id: 'puppy-howling',
    name: 'Puppy Howling',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Fear',
    description: 'Lets out a haunting howl that fills enemies with dread.',
    stage: 'rookie',
    digimon: 'Salamon',
  },

  // Patamon
  {
    id: 'angel-help',
    name: 'Angel Help',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Revitalize',
    description: 'Channels a gentle wave of holy energy that restores an ally.',
    stage: 'rookie',
    digimon: 'Patamon',
  },

  // Floramon
  {
    id: 'rain-of-pollen',
    name: 'Rain of Pollen',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Weaken',
    description: 'Releases a cloud of heavy pollen that saps the strength of those it coats.',
    stage: 'rookie',
    digimon: 'Floramon',
  },

  // DemiDevimon
  {
    id: 'evil-whisper',
    name: 'Evil Whisper',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Distract',
    description: 'Whispers dark suggestions that shatter an enemy\'s focus.',
    stage: 'rookie',
    digimon: 'DemiDevimon',
  },

  // Elecmon
  {
    id: 'thunder-cloud',
    name: 'Thunder Cloud',
    range: 'ranged',
    type: 'support',
    tags: ['Area Attack: Burst'],
    effect: 'Paralysis',
    description: 'Generates a static field that seizes the muscles of all nearby enemies.',
    stage: 'rookie',
    digimon: 'Elecmon',
  },

  // ==========================================
  // CHAMPION STAGE
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

  // Angemon
  {
    id: 'hand-of-fate',
    name: 'Hand of Fate',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon II', 'Armor Piercing II'],
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

  // Stingmon (Adventure 02)
  {
    id: 'spiking-strike',
    name: 'Spiking Strike',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon II', 'Armor Piercing II'],
    description: 'Stabs with its spikes.',
    stage: 'champion',
    digimon: 'Stingmon',
  },

  // Gargomon (Tamers)
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

  // Leomon — Mighty Blow gap
  {
    id: 'iron-fist',
    name: 'Iron Fist',
    range: 'melee',
    type: 'damage',
    tags: ['Mighty Blow'],
    description: 'A devastating heavy punch that can stun on a powerful hit.',
    stage: 'champion',
    digimon: 'Leomon',
  },

  // Devimon
  {
    id: 'touch-of-evil',
    name: 'Touch of Evil',
    range: 'melee',
    type: 'support',
    tags: [],
    effect: 'Immobilize',
    description: 'Grabs an enemy with dark tendrils, rooting them in place.',
    stage: 'champion',
    digimon: 'Devimon',
  },

  // Cockatrimon
  {
    id: 'petra-fire',
    name: 'Petra Fire',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Stun',
    description: 'Fires a petrifying ray that freezes enemies solid.',
    stage: 'champion',
    digimon: 'Cockatrimon',
  },

  // Garurumon
  {
    id: 'wolf-cry',
    name: 'Wolf Cry',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Fear',
    description: 'Lets loose a bone-chilling howl that sends enemies into a panic.',
    stage: 'champion',
    digimon: 'Garurumon',
  },

  // IceDevimon
  {
    id: 'frozen-tundra',
    name: 'Frozen Tundra',
    range: 'ranged',
    type: 'support',
    tags: ['Area Attack: Burst'],
    effect: 'Weaken',
    description: 'Radiates intense cold across the area, sapping enemy strength.',
    stage: 'champion',
    digimon: 'IceDevimon',
  },

  // Angemon
  {
    id: 'holy-shoot',
    name: 'Holy Shoot',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Revitalize',
    description: 'Fires a sphere of holy light that heals an ally on contact.',
    stage: 'champion',
    digimon: 'Angemon',
  },

  // Centarumon
  {
    id: 'solar-ray',
    name: 'Solar Ray',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Blind',
    description: 'Emits a concentrated beam of solar energy that blinds the target.',
    stage: 'champion',
    digimon: 'Centarumon',
  },

  // ==========================================
  // ULTIMATE STAGE
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
    tags: ['Weapon III', 'Armor Piercing III'],
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
    tags: ['Weapon III', 'Armor Piercing III'],
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

  // Rapidmon (Tamers)
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

  // Generic Ultimate — fills the Area Attack: Close Blast gap
  {
    id: 'shockwave',
    name: 'Shockwave',
    range: 'melee',
    type: 'damage',
    tags: ['Weapon III', 'Area Attack: Close Blast'],
    description: 'Releases a devastating pulse of energy that strikes all adjacent enemies.',
    stage: 'ultimate',
  },

  // Myotismon
  {
    id: 'grisly-wing',
    name: 'Grisly Wing',
    range: 'ranged',
    type: 'support',
    tags: ['Area Attack: Blast'],
    effect: 'Fear',
    description: 'Summons a massive swarm of bats that engulfs enemies and fills them with terror.',
    stage: 'ultimate',
    digimon: 'Myotismon',
  },
  {
    id: 'nightmare-claw',
    name: 'Nightmare Claw',
    range: 'melee',
    type: 'support',
    tags: [],
    effect: 'Blind',
    description: 'Rakes with claws wreathed in dark energy that plunges the target into darkness.',
    stage: 'ultimate',
    digimon: 'Myotismon',
  },

  // Angewomon
  {
    id: 'saint-air',
    name: 'Saint Air',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Shield',
    description: 'Surrounds an ally in a barrier of holy light that absorbs incoming damage.',
    stage: 'ultimate',
    digimon: 'Angewomon',
  },

  // Lillymon
  {
    id: 'temptation',
    name: 'Temptation',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Confuse',
    description: 'Releases an enchanting fragrance that confuses enemies into erratic action.',
    stage: 'ultimate',
    digimon: 'Lillymon',
  },

  // MagnaAngemon
  {
    id: 'soul-vanisher',
    name: 'Soul Vanisher',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Revitalize',
    description: 'Fires a purifying beam of holy energy that restores an ally\'s vitality.',
    stage: 'ultimate',
    digimon: 'MagnaAngemon',
  },

  // ==========================================
  // MEGA STAGE
  // ==========================================
  // WarGreymon
  {
    id: 'terra-force',
    name: 'Terra Force',
    range: 'ranged',
    type: 'damage',
    tags: ['Weapon III', 'Signature Move', 'Area Attack: Blast'],
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
    tags: ['Weapon III', 'Armor Piercing III', 'Signature Move'],
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

  // Seraphimon
  {
    id: 'seven-heavens',
    name: 'Seven Heavens',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Shield',
    description: 'Creates seven orbs of holy light that surround and protect an ally.',
    stage: 'mega',
    digimon: 'Seraphimon',
  },

  // Piedmon
  {
    id: 'clown-trick',
    name: 'Clown Trick',
    range: 'ranged',
    type: 'support',
    tags: ['Area Attack: Burst'],
    effect: 'Confuse',
    description: 'Unleashes a burst of disorienting illusions that confuse all nearby enemies.',
    stage: 'mega',
    digimon: 'Piedmon',
  },

  // Puppetmon
  {
    id: 'puppet-curse',
    name: 'Puppet Curse',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Weaken',
    description: 'Places a dark curse on an enemy that saps their power.',
    stage: 'mega',
    digimon: 'Puppetmon',
  },

  // Sakuyamon
  {
    id: 'fox-drive',
    name: 'Fox Drive',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Regenerate',
    description: 'Channels the power of fox spirits to steadily restore an ally\'s vitality.',
    stage: 'mega',
    digimon: 'Sakuyamon',
  },

  // Gallantmon
  {
    id: 'final-elysion',
    name: 'Final Elysion',
    range: 'ranged',
    type: 'support',
    tags: [],
    effect: 'Cleanse',
    description: 'Fires a beam of pure light from its Aegis shield that purifies all negative effects.',
    stage: 'mega',
    digimon: 'Gallantmon',
  },

  // Ophanimon
  {
    id: 'holy-hug',
    name: 'Holy Hug',
    range: 'melee',
    type: 'support',
    tags: [],
    effect: 'Revitalize',
    description: 'Enfolds an ally in a warm embrace of divine energy that restores them.',
    stage: 'mega',
    digimon: 'Ophanimon',
  },

  // ==========================================
  // UNIVERSAL ATTACKS (any stage)
  // ==========================================
  {
    id: 'body-blow',
    name: 'Body Blow',
    range: 'melee',
    type: 'damage',
    tags: [],
    effect: 'Weaken',
    description: 'A powerful strike to the body that leaves the target weakened.',
    stage: 'any',
    digimon: 'Various',
  },
  {
    id: 'flame',
    name: 'Flame',
    range: 'ranged',
    type: 'damage',
    tags: [],
    effect: 'Fear',
    description: 'Breathes or projects a gout of flame that frightens the target.',
    stage: 'any',
    digimon: 'Various',
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
