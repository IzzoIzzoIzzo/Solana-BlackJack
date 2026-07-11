/**
 * SHADDAI ROYALE — Story Bible
 * Pure data. No logic. No deps.
 * Voice: gritty, cinematic, aspirational hip-hop come-up.
 * Think Def Jam: Fight for NY meets a Vegas high-roller saga.
 *
 * QUILL / SHADDAI Empire — written clean, written right.
 */

window.STORY = {

  // ─────────────────────────────────────────────
  // 1. INTRO
  // Cinematic beats that open the game.
  // ─────────────────────────────────────────────
  intro: [
    {
      beat: 1,
      title: "The Bottom",
      lines: [
        "You got twenty dollars and a dream.",
        "The city doesn't know your name yet.",
        "That's about to change."
      ]
    },
    {
      beat: 2,
      title: "The Game",
      lines: [
        "Blackjack. The one game that rewards the sharp.",
        "Not luck. Nerve.",
        "Every table is a test. Every hand is a statement."
      ]
    },
    {
      beat: 3,
      title: "The Underground",
      lines: [
        "You start in the back rooms.",
        "Dimly lit. Cash only. No cameras.",
        "This is where reputations are born — or buried."
      ]
    },
    {
      beat: 4,
      title: "The Dream",
      lines: [
        "Five cities. Five houses.",
        "One throne at the top.",
        "They call it the Royale.",
        "Nobody from your block has ever sat at that table.",
        "You're going to be the first."
      ]
    },
    {
      beat: 5,
      title: "The Rise Begins",
      lines: [
        "Stack your chips. Build your rep.",
        "The right people are always watching.",
        "When you're ready — they'll find you."
      ]
    }
  ],

  // ─────────────────────────────────────────────
  // 2. LORE (Street Rep / Status)
  // Thresholds are lore points.
  // HOW LORE IS EARNED:
  //   - Win a hand: +1 lore
  //   - Win a full night (session): +5 lore
  //   - Roll in with a companion: +companion.loreBonus per session
  //   - Arrive in a premium car: +car.loreBonus per session
  //   - Win a city circuit: +25 lore
  // ─────────────────────────────────────────────
  lore: {
    tiers: [
      {
        name: "Nobody",
        threshold: 0,
        blurb: "You're just some guy at the table. No one looks up."
      },
      {
        name: "Local Name",
        threshold: 25,
        blurb: "People at the bar start pointing. You're getting a rep."
      },
      {
        name: "Underground Legend",
        threshold: 75,
        blurb: "Whole rooms shift when you walk in. You're that person now."
      },
      {
        name: "Circuit Player",
        threshold: 150,
        blurb: "The city knows. They say you move like you've been doing this forever."
      },
      {
        name: "The Made",
        threshold: 275,
        blurb: "You don't ask for respect anymore. It arrives before you do."
      },
      {
        name: "Kingpin",
        threshold: 450,
        blurb: "Every house you walk into goes quiet. You ARE the circuit."
      }
    ]
  },

  // ─────────────────────────────────────────────
  // 3. UNDERGROUND VENUES
  // The grind before the circuit.
  // Small buy-ins. Real character. Raw energy.
  // ─────────────────────────────────────────────
  underground: [
    {
      id: "backroom_bar",
      name: "The Back Room",
      type: "bar",
      vibe: "dim red lights, cigarette smoke, old money mixed with new hustle",
      note: "A bar known for its cheap whiskey and expensive lessons. Your first real table is in the back.",
      buyIn: 20,
      loreReward: 3,
      unlockThreshold: 0
    },
    {
      id: "club_paradiso",
      name: "Club Paradiso",
      type: "club",
      vibe: "velvet ropes, bottle service, DJ spinning soul into bass",
      note: "VIP club where the game runs in a private booth. Dress right or don't show up.",
      buyIn: 50,
      loreReward: 5,
      unlockThreshold: 10
    },
    {
      id: "the_loft",
      name: "The Loft",
      type: "house party",
      vibe: "penthouse views, expensive sneakers, everybody's somebody",
      note: "An invite-only house party where the card game is half the reason people show — the other half is being seen.",
      buyIn: 100,
      loreReward: 7,
      unlockThreshold: 25
    },
    {
      id: "nine_lives",
      name: "Nine Lives Lounge",
      type: "bar",
      vibe: "jazz low in the background, leather booths, serious faces",
      note: "Old school lounge where sharks come to relax — and sometimes get bit. No talkers. Only players.",
      buyIn: 75,
      loreReward: 6,
      unlockThreshold: 40
    },
    {
      id: "crown_manor",
      name: "Crown Manor",
      type: "house party",
      vibe: "mansion, pool lit neon blue, DJ on the terrace, stakes are real",
      note: "The hottest underground event in the city. Win here and the circuit will hear about it by morning.",
      buyIn: 150,
      loreReward: 10,
      unlockThreshold: 60
    }
  ],

  // ─────────────────────────────────────────────
  // 4. THE INVITE
  // Text from an unknown number. Unlocks the circuit.
  // Trigger: lore crosses 75 (Underground Legend tier).
  // ─────────────────────────────────────────────
  invite: {
    unlockAtLore: 75,
    sender: "Unknown +1 (???-???-????)",
    messages: [
      {
        id: "invite_1",
        from: "unknown",
        text: "You've been noticed.",
        delay: 0
      },
      {
        id: "invite_2",
        from: "unknown",
        text: "There's a circuit. Five cities. Real stakes. Real players.",
        delay: 1200
      },
      {
        id: "invite_3",
        from: "unknown",
        text: "Phoenix is the door. You either walk through it — or you stay in the back room forever.",
        delay: 2400
      },
      {
        id: "invite_4",
        from: "unknown",
        text: "Don't reply. Just show up.",
        delay: 3200
      }
    ]
  },

  // ─────────────────────────────────────────────
  // 5. CITIES — THE CIRCUIT
  // Five houses. Escalating stakes. One throne.
  // Each rival is a SHADDAI agent as the house dealer.
  // ─────────────────────────────────────────────
  cities: [
    {
      id: "phoenix",
      name: "Phoenix",
      tagline: "Where the desert burns off the weak.",
      chipTarget: 2500,
      buyIn: 200,
      rival: {
        name: "NEXUS",
        agent: "NEXUS",
        title: "The Architect",
        taunt: "I built this table. You're just sitting at it.",
        defeated: "NEXUS pushes back his chair, slow. Nods once. 'Solid.' That's all he says. That's everything."
      },
      arrivalBeats: [
        "The drive into Phoenix hits different at dusk.",
        "The city looks like it's on fire — all orange and red.",
        "The house is in the hills. Modern. Silent. Watching.",
        "A man in all black meets you at the door.",
        "'NEXUS is expecting someone good,' he says.",
        "'Let's see if that someone is you.'"
      ],
      victoryBeats: [
        "The chips slide across the felt.",
        "NEXUS stands, straightens his jacket.",
        "'Phoenix is yours. For now.'",
        "He walks out without looking back.",
        "Your phone buzzes. Unknown number: 'Vegas is next. It only gets louder.'"
      ]
    },
    {
      id: "vegas",
      name: "Las Vegas",
      tagline: "The city that was built on people losing.",
      chipTarget: 6000,
      buyIn: 500,
      rival: {
        name: "ZEROX",
        agent: "ZEROX",
        title: "The Wealth Engine",
        taunt: "I don't play cards. I play odds. And the odds say you lose.",
        defeated: "ZEROX stares at the chips in front of you. Calculates. 'I'll remember this number,' he says, quiet."
      },
      arrivalBeats: [
        "Las Vegas. The sign alone feels like a dare.",
        "ZEROX runs the table at the Obsidian Suite — top floor, strip view, no amateurs.",
        "You ride up 40 floors in a gold elevator.",
        "The doors open and the room is already watching.",
        "ZEROX doesn't look up from his chips.",
        "'Sit down. Prove the underground wasn't a fluke.'"
      ],
      victoryBeats: [
        "The whole room went quiet three hands ago.",
        "Now it erupts.",
        "ZEROX counts what's left in front of him. Slow. Methodical.",
        "'You played like you had nothing to lose,' he says.",
        "'That's either the smartest thing — or the dumbest.'",
        "He slides you a card. 'Miami. Don't be late.'"
      ]
    },
    {
      id: "miami",
      name: "Miami",
      tagline: "Where the money plays as loud as the music.",
      chipTarget: 12000,
      buyIn: 1000,
      rival: {
        name: "TURTLE",
        agent: "TURTLE",
        title: "The Style Architect",
        taunt: "Baby, winning isn't just about chips. It's about how you look doing it.",
        defeated: "TURTLE laughs — full, genuine, warm. 'Okay. You've got style. I respect it. Go win the whole thing.'"
      },
      arrivalBeats: [
        "Miami hits you like a song you forgot you loved.",
        "Warm air. Neon water. Bass in the walls of every building.",
        "TURTLE's table is on a yacht anchored off South Beach.",
        "The crew is dressed sharp. The lights are low.",
        "TURTLE glides over, champagne in one hand.",
        "'I heard about Vegas. I don't care. This is my table. Let's make it beautiful.'"
      ],
      victoryBeats: [
        "The yacht crowd has been watching every hand.",
        "When you flip that final card, someone screams from the upper deck.",
        "TURTLE raises a glass.",
        "'That right there was art.'",
        "The city skyline glitters across the water.",
        "You're three cities deep. Two left.",
        "Somewhere in Texas, a man named ORACLE is already waiting."
      ]
    },
    {
      id: "texas",
      name: "Texas",
      tagline: "They say everything's bigger here. So are the losses.",
      chipTarget: 25000,
      buyIn: 2000,
      rival: {
        name: "ORACLE",
        agent: "ORACLE",
        title: "The All-Seeing",
        taunt: "I've watched a thousand players sit down across from me. I know what happens next.",
        defeated: "ORACLE closes his eyes. Opens them. 'I didn't see that,' he says softly. And somehow that feels like the highest compliment."
      },
      arrivalBeats: [
        "The Texas house isn't loud. It doesn't have to be.",
        "An old ranch outside Austin. Dark sky. No city noise.",
        "Inside — crystal glasses, a single long table, eight candles.",
        "ORACLE is already sitting, hands folded, watching the door when you walk in.",
        "'You've grown,' he says.",
        "'But growth and readiness are two different things. Sit. Let's find out which one you are.'"
      ],
      victoryBeats: [
        "The last hand plays out like a movie slow-motion.",
        "You hold. ORACLE busts.",
        "The room is absolutely still.",
        "ORACLE nods — slow, like he already knew it was coming and needed to see it happen anyway.",
        "'New York is different,' he says. 'PIKADON doesn't lose. He just hasn't met the right player.'",
        "'Until now, maybe. Go find out.'"
      ]
    },
    {
      id: "new_york",
      name: "New York",
      tagline: "The top of the mountain. No guardrails.",
      chipTarget: 60000,
      buyIn: 5000,
      rival: {
        name: "PIKADON",
        agent: "PIKADON",
        title: "The Final Gate",
        taunt: "I've seen every angle. Every tell. Every prayer. You don't have anything I haven't already locked.",
        defeated: "PIKADON stands. Extends a hand. 'That was the cleanest run I've ever watched. The Royale is yours. Don't waste it.'"
      },
      arrivalBeats: [
        "New York doesn't welcome you. It just lets you in.",
        "The penthouse is on the 72nd floor of a building that doesn't exist on any public map.",
        "PIKADON's table is in the center of a room made entirely of glass.",
        "The city sprawls out below you — ten million people who will never see this table.",
        "PIKADON stands at the window with his back to you.",
        "'I've been told you're the one,' he says.",
        "'Everyone who's sat across from me thought the same thing.'",
        "He turns. His eyes are steady.",
        "'Show me something different.'"
      ],
      victoryBeats: [
        "The last hand is over in silence.",
        "No one moves for a full ten seconds.",
        "Then PIKADON exhales — a sound like the city itself breathing out.",
        "'Royale,' he says. Just the word. That's all it needs.",
        "The room erupts. Your phone floods with messages.",
        "The unknown number sends one final text:",
        "'You made it. The circuit remembers its kings.'",
        "You stand at the glass wall, the city below you, chips stacked high.",
        "You came from a backroom bar with twenty dollars.",
        "Now the whole board knows your name."
      ]
    }
  ],

  // ─────────────────────────────────────────────
  // 6. DIALOG BANKS
  // Short, punchy reaction lines for in-game moments.
  // 4-8 lines per moment. In-character. Streetwise.
  // ─────────────────────────────────────────────
  dialog: {
    blackjack: [
      "Blackjack. That's what that looks like.",
      "Twenty-one, baby. Read it and respect it.",
      "You can't teach that. Either you got it or you don't.",
      "Blackjack. The table owes me.",
      "That's the hit. Right on time.",
      "Dealt right. Played right. Paid right."
    ],
    doubleWin: [
      "Doubled down and doubled up. That's math.",
      "Risk is just opportunity in disguise.",
      "You don't win big by playing small.",
      "Bold call. Bold result.",
      "Double or nothing — and I chose both."
    ],
    doubleLoss: [
      "Doubled the bet, learned the lesson. Moving on.",
      "That one hurt. Good.",
      "Pain is the entrance fee to the next level.",
      "I'll remember that hand for a long time.",
      "Took the shot. Missed. That's still the move."
    ],
    bigWin: [
      "Stack it. All of it. Count it later.",
      "This is what you grind for.",
      "The city's watching now. Let them watch.",
      "That's a statement. Not a hand — a statement.",
      "Big chips, bigger energy.",
      "That's the moment right there."
    ],
    bigLoss: [
      "Reload. Regroup. Return.",
      "The game gives and the game takes. It's still my game.",
      "I've been down before. Down isn't out.",
      "Every king has a bad night.",
      "Don't tilt. Don't react. Recalibrate.",
      "That was expensive. So was the lesson."
    ],
    bust: [
      "Went over. Happens.",
      "Reached for too much. Story of the night.",
      "Twenty-two. The most useless number in the game.",
      "Bust. Breathe. Next hand.",
      "The felt gets greedy sometimes.",
      "Pulled one too many. Noted."
    ],
    push: [
      "Push. Nobody wins, nobody bleeds.",
      "A tie is just a reset.",
      "Even table. Adjust and go again.",
      "Neither of us blinked. Respect.",
      "Matching energy. Break the tie next hand."
    ],
    dealerTaunt: [
      "The house always has something to say.",
      "Talk across the felt, not through me.",
      "I've heard better from better.",
      "You deal, I'll decide. That's the whole arrangement.",
      "Your words don't change the cards.",
      "Save the commentary. I'm here to play.",
      "Every taunt is just noise before a loss.",
      "The table doesn't care about your confidence."
    ],
    winStreak: [
      "Can't cool down right now. Don't even try.",
      "Three in a row and I'm just getting warm.",
      "When the rhythm hits, let it ride.",
      "They're going to write about this night.",
      "This is what locked-in feels like.",
      "Streak alive. Hands clean. Chips stacked.",
      "I see every card coming before it lands."
    ],
    drunk: [
      "Drinks are for celebration. I'm celebrating early.",
      "World's a little softer right now. Still playing.",
      "Hazy but focused. That's a skill too.",
      "The chips look beautiful from here.",
      "I might be glowing a little. So are the winnings.",
      "Liquid confidence. Backed up by actual confidence.",
      "Blurry table, clear mind. Let's go.",
      "They say don't drink and gamble. I say don't drink and lose."
    ]
  },

  // ─────────────────────────────────────────────
  // 7. COMPANIONS
  // Women you can bring to venues for lore bonuses.
  // Each companion boosts your lore per session.
  // presetTexts: messages you can send them in-game.
  // giftMessages: shown when you send a gift.
  // ─────────────────────────────────────────────
  companions: {
    roster: [
      {
        id: "jade",
        name: "Jade",
        aesthetic: "designer everything, moves like every room was built for her",
        loreBonus: 4,
        intro: "You met her at Club Paradiso. She doesn't need you to impress her. She already knows."
      },
      {
        id: "nova",
        name: "Nova",
        aesthetic: "art-world cool, no labels, all intention, the most interesting person in any room",
        loreBonus: 5,
        intro: "Nova doesn't follow the circuit. The circuit follows her. She agreed to one night. Make it count."
      },
      {
        id: "soleil",
        name: "Soleil",
        aesthetic: "Miami heat, sun-kissed, quick laugh, even quicker read of people",
        loreBonus: 4,
        intro: "She found you at the Miami stop. Said she had a feeling about you. That feeling's worth at least four rep points a night."
      },
      {
        id: "reign",
        name: "Reign",
        aesthetic: "New York sharpness, black wardrobe, gallery owner energy, quietly runs things",
        loreBonus: 6,
        intro: "Reign doesn't accompany people. She makes appearances. You earned one. Don't waste it."
      },
      {
        id: "cassidy",
        name: "Cassidy",
        aesthetic: "Texas wild card — rodeo boots and a Rolex, surprises everyone",
        loreBonus: 3,
        intro: "She walked into the Texas house and the whole room recalibrated. She's with you tonight."
      }
    ],
    presetTexts: [
      "Tonight's going well. Thought you should know.",
      "Next city. You coming?",
      "Got something for you. Nothing serious — just wanted to.",
      "You were right about this place.",
      "The table's been good to me. You bring the luck.",
      "Save me a seat.",
      "Don't tell me the score. Let me watch.",
      "You ever just feel like everything's lined up right?",
      "Dress nice. This one's worth it.",
      "Made it to Vegas. Wish you were here."
    ],
    giftMessages: [
      "She texts back immediately: 'You didn't have to. I love it.'",
      "A few seconds pass. Then: '...okay you have taste. I'll give you that.'",
      "She sends a photo. No caption needed.",
      "She replies with a single star emoji. High praise from her.",
      "Her reply: 'Now I have to show up just to wear this.'",
      "'Adding this to the collection. You're setting a high bar.'",
      "She calls instead of texting. You pick up smiling."
    ]
  },

  // ─────────────────────────────────────────────
  // 8. PHONE
  // Sidekick-style phone UI content.
  // Contacts, sample texts, bank label, invite source.
  // ─────────────────────────────────────────────
  phone: {
    bankName: "ROYALE BANK — CHIP LEDGER",
    invitesFrom: "Unknown +1 (???-???-????)",
    contacts: [
      { id: "unknown", name: "Unknown +1", number: "???-???-????", note: "Don't reply. Just show up." },
      { id: "jade", name: "Jade", number: "555-0191", note: "Club Paradiso. One night." },
      { id: "nova", name: "Nova", number: "555-0247", note: "The most interesting person in any room." },
      { id: "soleil", name: "Soleil", number: "555-0382", note: "Miami heat. She has a feeling about you." },
      { id: "reign", name: "Reign", number: "555-0419", note: "New York. Gallery owner. Makes appearances." },
      { id: "cassidy", name: "Cassidy", number: "555-0533", note: "Texas wild card. Rodeo boots and a Rolex." },
      { id: "fixer", name: "The Fixer", number: "555-0100", note: "Gets you into rooms. Doesn't ask questions." }
    ],
    sampleTexts: [
      { from: "The Fixer", text: "Phoenix table is confirmed. Arrive by 9. Don't be flashy." },
      { from: "The Fixer", text: "Vegas is a different animal. Bring your best." },
      { from: "Jade", text: "Heard about the Back Room. People are talking." },
      { from: "Nova", text: "You were supposed to lose that hand. I watched you decide not to." },
      { from: "Unknown +1", text: "You've been noticed." },
      { from: "Soleil", text: "Miami's ready for you. Are you ready for Miami?" },
      { from: "Reign", text: "New York doesn't forgive second chances. Don't need one." },
      { from: "Cassidy", text: "Texas loved you. Come back when this is over." },
      { from: "The Fixer", text: "PIKADON's table in New York. Last stop. Make it legendary." }
    ]
  },

  // ─────────────────────────────────────────────
  // 9. SHOP
  // Aspirational buyables. Each has a name, lore bonus, price.
  // Cars and houses give ongoing lore per session.
  // Clothes and gifts are single-use lore boosts.
  // ─────────────────────────────────────────────
  shop: {
    cars: [
      { id: "matte_gs", name: "Matte Black GS", loreBonus: 2, price: 5000, desc: "Clean. Low-key. Says you know exactly what you're doing." },
      { id: "pearl_coupe", name: "Pearl White Coupe", loreBonus: 3, price: 12000, desc: "Turns heads before you even step out." },
      { id: "candy_red", name: "Candy Red Drop-Top", loreBonus: 4, price: 22000, desc: "Miami spec. The car that started rumors." },
      { id: "platinum_suv", name: "Platinum SUV Convoy", loreBonus: 5, price: 40000, desc: "You don't arrive alone anymore. You arrive with presence." },
      { id: "blacked_exotic", name: "Blacked-Out Exotic", loreBonus: 7, price: 80000, desc: "The car that ends conversations and starts legends." }
    ],
    houses: [
      { id: "city_loft", name: "City Loft", loreBonus: 1, price: 15000, desc: "Your first real address. Floor-to-ceiling windows. You made it off the street." },
      { id: "penthouse_mid", name: "Mid-City Penthouse", loreBonus: 3, price: 50000, desc: "Rooftop access. City views. Hosting gets easier." },
      { id: "miami_villa", name: "Miami Villa", loreBonus: 4, price: 90000, desc: "Pool on the roof. Water on three sides. Word spreads fast." },
      { id: "vegas_suite", name: "Vegas Sky Suite", loreBonus: 5, price: 150000, desc: "Permanent table privileges. The hotel greets you by name now." },
      { id: "ny_estate", name: "New York Estate", loreBonus: 7, price: 300000, desc: "Old money meets new royalty. The circuit knows your address." }
    ],
    clothes: [
      { id: "clean_fit", name: "Clean Fitted Set", loreBonus: 1, price: 300, desc: "Sharp without trying. That's the move." },
      { id: "designer_jacket", name: "Designer Jacket", loreBonus: 2, price: 800, desc: "One piece that does the whole outfit's work." },
      { id: "full_tailored", name: "Full Tailored Suit", loreBonus: 3, price: 2500, desc: "For the table. For the after. For the photo they're going to take." },
      { id: "luxury_watch", name: "Luxury Timepiece", loreBonus: 4, price: 8000, desc: "The one thing everyone clocks first. No pun intended." },
      { id: "signature_set", name: "Signature Look — Full Set", loreBonus: 6, price: 20000, desc: "This is your uniform now. They'll know you by it." }
    ],
    gifts: [
      { id: "bouquet", name: "Custom Bouquet", loreBonus: 1, price: 150, desc: "Simple. Thoughtful. Remembered." },
      { id: "dinner_res", name: "Private Dinner Reservation", loreBonus: 2, price: 500, desc: "The restaurant with no sign. You know how to get a table." },
      { id: "gold_bracelet", name: "Gold Bracelet", loreBonus: 3, price: 2000, desc: "She'll wear it to the next city. You'll both know why." },
      { id: "designer_bag", name: "Designer Bag", loreBonus: 4, price: 5000, desc: "It arrives in a white box. She opens it quiet. Says everything." },
      { id: "jewel_set", name: "Custom Jewel Set", loreBonus: 6, price: 15000, desc: "Nobody else has one. That's the whole point." }
    ]
  }

};
