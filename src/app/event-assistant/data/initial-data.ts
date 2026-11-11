export interface Room {
  id: string;
  name: string;
  dutchName: string;
  category:
    | 'Main Event Hall'
    | 'Lounge & Hospitality'
    | 'Auditorium'
    | 'Meeting & Conference'
    | 'Gaming & Esports'
    | 'Outdoor';
  capacityDisplay: string;
  minCapacity: number;
  maxCapacity?: number;
  capacityVerified: boolean;
  unconfirmedNote?: string;
  areaM2?: number;
  dimensions?: string;
  ceilingHeight?: string;
  mainstage?: string;
  ledScreen?: string;
  audio?: string;
  facilities: string[];
  description: string;
  suitableFor: string[];
  imageUrl: string;
  isActive: boolean;
  baseHourlyRate?: number;
}

export interface InternalNote {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

export interface Booking {
  requestStatus?: 'pending_review' | 'approved' | 'rejected';
  explanation?: string;
  planning?: {
    startTime: string;
    endTime: string;
    activity: string;
    room: string;
    materials: string;
    responsible: string;
  }[];
  reviewNotes?: string;
  id: string;
  reference: string;
  customer: {
    fullName: string;
    email: string;
    phone: string;
    company: string;
    billingAddress: {
      street: string;
      postalCode: string;
      city: string;
      country: string;
    };
  };
  event: {
    name: string;
    type: string;
    participants: number;
    description: string;
    room: {
      id: string;
      name: string;
    };
    additionalRooms?: {
      id: string;
      name: string;
      price?: number;
    }[];
    date: string; // YYYY-MM-DD
    alternativeDate?: string;
    startTime: string; // HH:mm
    endTime: string; // HH:mm
    durationHours: number;
  };
  selections: {
    activities: string[];
    gamingPreferences: string[];
    vrPreferences: string[];
    cateringSelections: string[];
    addons?: {
      id: string;
      name: string;
      price: number;
    }[];
    specialRequests: string;
    customerNotes: string;
  };
  financial: {
    totalPrice: number;
    vatAmount: number;
    vatRate: number; // e.g. 21%
    amountPaid: number;
    outstandingAmount: number;
    paymentMethod: string;
    paymentReference: string;
    paymentDate: string;
    refundStatus: 'None' | 'Requested' | 'Partial' | 'Full';
    refundAmount?: number;
    refundReason?: string;
  };
  reservation: {
    bookingReference: string;
    createdAt: string;
    bookingStatus:
      | 'Draft'
      | 'Awaiting Availability'
      | 'Awaiting Approval'
      | 'Awaiting Payment'
      | 'Paid'
      | 'Confirmed'
      | 'Cancelled'
      | 'Refunded';
    availabilityVerified: boolean;
    adminApprovalStatus: 'Approved' | 'Pending' | 'Rejected';
    internalNotes: InternalNote[];
  };
}

export interface AvailabilityBlock {
  id: string;
  roomId: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  type: 'Maintenance' | 'Private Event' | 'Closure' | 'Admin Block';
  createdAt: string;
  createdBy: string;
}

export interface ActivityLog {
  id: string;
  admin: string;
  action: string;
  previousValue: string;
  newValue: string;
  relatedItem: string;
  timestamp: string;
}

export interface Customer {
  id: string;
  fullName: string;
  company: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  createdAt: string;
  notes: string;
}

export const INITIAL_ROOMS: Room[] = [
  {
    id: 'rabo-esports-stadium',
    name: 'Rabo Esports Stadium',
    dutchName: 'Rabo Esports Stadium',
    category: 'Main Event Hall',
    capacityDisplay: '50 – 1.200 personen',
    minCapacity: 50,
    maxCapacity: 1200,
    capacityVerified: true,
    areaM2: 1056,
    dimensions: '44 × 24 meter',
    ceilingHeight: '7 meter',
    mainstage: '22 meter breed en 6,5 meter hoog',
    ledScreen: '50 m² custom high-res LED wall',
    audio: 'Professioneel Bose surround audiosysteem',
    facilities: [
      '50 m² LED Screen',
      'Bose Surround Sound',
      'Professionele Regiekamer',
      'Broadcast & Livestream Setup',
      'RGB Lichtshow',
      'Mainstage 22m x 6.5m',
      'VIP Skybox',
    ],
    description:
      'Het toonaangevende gaming- en esportstadion van Europa. Ideaal voor grootschalige congressen, productlanceringen, toernooien, award shows en spectaculaire bedrijfsfeesten.',
    suitableFor: [
      'Conferenties',
      'Gala evenementen',
      'Grote bedrijfsevenementen',
      'Esports toernooien',
      'Feesten',
      'Presentaties',
      'Grote gaming evenementen',
    ],
    imageUrl: '/assets/aistudio/image_0751adcb.png',
    isActive: true,
    baseHourlyRate: 650,
  },
  {
    id: 'h20-lounge-cafe',
    name: 'H20 Lounge Café',
    dutchName: 'H20 Lounge Café',
    category: 'Lounge & Hospitality',
    capacityDisplay: '30 – 200 personen',
    minCapacity: 30,
    maxCapacity: 200,
    capacityVerified: true,
    areaM2: 320,
    facilities: [
      'Eigen bar met tapinstallatie',
      'Luxe lounge fauteuils',
      'Hoge bartafels',
      'Sfeerverlichting',
      'DJ Booth aansluiting',
      'Geluidsinstallatie',
    ],
    description:
      'Sfeervolle lounge met private bar, comfortabele zitjes en een ontspannen tech-ambiance voor borrels, networking en feesten.',
    suitableFor: [
      'Networking',
      'Borrels & recepties',
      'Bedrijfsbijeenkomsten',
      'Informele bijeenkomsten',
      'Sociale evenementen',
    ],
    imageUrl: '/assets/aistudio/image_dc068a8c.png',
    isActive: true,
    baseHourlyRate: 220,
  },
  {
    id: 'aula',
    name: 'Aula',
    dutchName: 'Aula',
    category: 'Auditorium',
    capacityDisplay: '10 – 60 personen',
    minCapacity: 10,
    maxCapacity: 60,
    capacityVerified: true,
    areaM2: 120,
    facilities: [
      'Grote projectiewand',
      'Draadloze microfoons',
      'Docentenpodium',
      'Auditorium theateropstelling',
      'Klimaatbeheersing',
    ],
    description:
      'Praktische theater- en presentatiezaal met opklapbare stoelen en uitstekende akoestiek voor workshops en presentaties.',
    suitableFor: [
      'Vergaderingen',
      'Presentaties',
      'Workshops',
      'Kleine groepsbijeenkomsten',
      'Keynotes',
    ],
    imageUrl: '/assets/aistudio/image_874226e3.png',
    isActive: true,
    baseHourlyRate: 140,
  },
  {
    id: 'rabo-meeting-room',
    name: 'Rabo Meeting Room',
    dutchName: 'Rabo Meeting Room',
    category: 'Meeting & Conference',
    capacityDisplay: 'Tot 12 personen',
    minCapacity: 2,
    maxCapacity: 12,
    capacityVerified: true,
    unconfirmedNote: 'Oppervlakte m² niet gepubliceerd tot officiële bevestiging door H20.',
    facilities: [
      'Boardroom vergadertafel voor 12 personen',
      '85" 4K UHD Presentatiescherm',
      'Professioneel Videoconferencing Systeem (Teams/Zoom/Meet)',
      'Akoestische wandpanelen',
      'Pantry & espressovoorziening',
      'Luxe directiestoelen',
    ],
    description:
      'Exclusieve directiekamer en boardroom voorzien van vergadertafel voor maximaal 12 personen, 4K presentatiescherm en hoogwaardige videoconferencing.',
    suitableFor: [
      'Directievergaderingen',
      'Boardroom meetings',
      'Hybride vergaderingen',
      'Besloten overleg',
      'Kwartaalsessies',
    ],
    imageUrl: '/assets/aistudio/image_fc0bbb18.png',
    isActive: true,
    baseHourlyRate: 180,
  },
  {
    id: 'aquarium',
    name: 'Aquarium',
    dutchName: 'Aquarium',
    category: 'Meeting & Conference',
    capacityDisplay: 'Flexibele capaciteit (Niet bevestigd)',
    minCapacity: 8,
    capacityVerified: false,
    unconfirmedNote: 'Exacte maximale capaciteit en m² vereisen officiële bevestiging door H20.',
    facilities: [
      'Glazen wanden met privacyschakelaar',
      'Moderne modulaire tafels',
      'Ultra-wide presentatieschermen',
      'Design whiteboard',
      'Klimaatbeheersing',
    ],
    description:
      'Lichte, glazen ruimte met transparante architectuur voor dynamische brainstorms, design sprints en creatief teamoverleg.',
    suitableFor: [
      'Brainstorms & Innovatie',
      'Design Sprints',
      'Creatieve Workshops',
      'Teamoverleg',
    ],
    imageUrl: '/assets/aistudio/image_02d80b94.png',
    isActive: true,
    baseHourlyRate: 160,
  },
  {
    id: 'community-area',
    name: 'Community Area',
    dutchName: 'Community Area',
    category: 'Lounge & Hospitality',
    capacityDisplay: 'ca. 10 personen',
    minCapacity: 4,
    maxCapacity: 12,
    capacityVerified: true,
    areaM2: 60,
    facilities: [
      'Informele lounge zithoek',
      'Koffiecorner & bartafels',
      'High-speed gigabit WiFi',
      'Whiteboard',
      'Open gezellige sfeer',
    ],
    description:
      'Compacte, informele huiskameromgeving voor kleinschalige meetings, 1-op-1 gesprekken en community bijeenkomsten.',
    suitableFor: [
      'Kleinschalige bijeenkomsten',
      '1-op-1 gesprekken',
      'Community meetups',
      'Co-working breaks',
    ],
    imageUrl: '/assets/aistudio/image_d13e820e.png',
    isActive: true,
    baseHourlyRate: 75,
  },
  {
    id: 'predator-gaming-room',
    name: 'Predator Gaming Room',
    dutchName: 'Predator Gaming Room',
    category: 'Gaming & Esports',
    capacityDisplay: '10 – 15 personen',
    minCapacity: 10,
    maxCapacity: 15,
    capacityVerified: true,
    areaM2: 95,
    facilities: [
      '15 High-end Acer Predator Gaming PCs',
      '240Hz Gaming Monitors & Mechanische toetsenborden',
      'Professionele esports headsets',
      'RGB Blackout Gaming Ambiance',
      'Dedicated toernooiservers & gigabit glasvezel',
    ],
    description:
      "De toonaangevende esports battleground met 15 high-end Acer Predator 240Hz gaming-pc's voor toernooien, bootcamps en competities.",
    suitableFor: [
      'Esports toernooien',
      'LAN gaming battles',
      'Bootcamps',
      'Competitieve teambuilding',
    ],
    imageUrl: '/assets/aistudio/image_2026-11-11_090113657_dfc51fa1.png',
    isActive: true,
    baseHourlyRate: 195,
  },
  {
    id: 'predator-streaming-studio',
    name: 'Predator Streaming Room',
    dutchName: 'Predator Streaming Room',
    category: 'Gaming & Esports',
    capacityDisplay: '4 – 8 personen',
    minCapacity: 2,
    maxCapacity: 8,
    capacityVerified: true,
    facilities: [
      "4K PTZ Broadcast Camera's",
      'Elgato Stream Deck & Audio Mixers',
      'Shure / Rode Broadcast Microfoons',
      'Professionele Studiobelichting & Softboxen',
      'Green Screen Wand & Akoestische Damping',
      'Dedicated Regie & Streaming PC',
    ],
    description:
      'Professionele opname- en streamingstudio voor content creators, esports casters, podcastmakers en live webinars.',
    suitableFor: [
      'Livestreaming & Casting',
      'Podcast Opnames',
      'Webinars',
      'Video Content Productie',
    ],
    imageUrl: '/assets/aistudio/image_bb08069a.png',
    isActive: true,
    baseHourlyRate: 160,
  },
  {
    id: 'xxl-vergaderruimte',
    name: 'XXL Meeting Room',
    dutchName: 'XXL Vergaderruimte',
    category: 'Meeting & Conference',
    capacityDisplay: 'Tot 30 personen',
    minCapacity: 10,
    maxCapacity: 30,
    capacityVerified: true,
    areaM2: 180,
    facilities: [
      '30 Luxe conferentiestoelen in theater- of U-vorm',
      'Groot interactief 85" touchscreen display',
      'Conferentie microfoonsystemen & zaalversterking',
      'Videoconferencing (Teams / Zoom / Meet)',
      'Klimaatbeheersing & whiteboard',
    ],
    description:
      'Grote multifunctionele zakelijke zaal voor maximaal 30 personen, voorzien van interactief 85" presentatiescherm en videoconferencing.',
    suitableFor: [
      'Directievergaderingen',
      'Seminars & Trainingen',
      'Formele Presentaties',
      'Kwartaalmeetings',
    ],
    imageUrl: '/assets/aistudio/image_c33e0b24.png',
    isActive: true,
    baseHourlyRate: 210,
  },
  {
    id: 'vrgaderruimte',
    name: 'VRgaderruimte',
    dutchName: 'VRgaderruimte',
    category: 'Gaming & Esports',
    capacityDisplay: 'Tot 6 personen',
    minCapacity: 2,
    maxCapacity: 6,
    capacityVerified: true,
    facilities: [
      'Meta Quest Pro & HTC Vive VR Headsets',
      'Draadloze tracking sensoren & speelvakken',
      'Vergadertafel voor maximaal 6 personen',
      'Centraal toeschouwersscherm',
      'Mixed Reality tools & begeleiding',
    ],
    description:
      'Innovatieve high-tech ruimte voor maximaal 6 personen die traditioneel overleg combineert met Virtual Reality experiences en interactieve simulaties.',
    suitableFor: [
      'Innovatiesessies',
      'VR Teambuilding',
      'Virtuele Simulaties',
      'Interactieve Workshops',
    ],
    imageUrl: '/assets/aistudio/image_fc399680.png',
    isActive: true,
    baseHourlyRate: 180,
  },
  {
    id: 'buitenruimte',
    name: 'Buitenruimte (Outdoor Area)',
    dutchName: 'Buitenruimte',
    category: 'Outdoor',
    capacityDisplay: 'Tot 250 personen • 300 m²',
    minCapacity: 20,
    maxCapacity: 250,
    capacityVerified: true,
    unconfirmedNote: 'Let op: weersafhankelijke buitenlocatie.',
    areaM2: 300,
    facilities: [
      'Groot buitenterras (300 m²)',
      'Picknickbanken & comfortabele terraszitjes',
      'Aansluitingen voor foodtrucks & professionele BBQ grills',
      'Overdekte luifelzone',
      'Buitenverlichting & terrasheaters',
    ],
    description:
      'Uitgestrekt privéterrein van 300 m² voor zonnige netwerkborrels, outdoor teambuilding games, barbecues en zomerfestivals.',
    suitableFor: [
      'Buitenactiviteiten & Teambuilding',
      'Outdoor Barbecues & Foodtrucks',
      'Zomerfestivals',
      'Openlucht Netwerkborrels',
    ],
    imageUrl: '/assets/aistudio/image_db09b131.png',
    isActive: true,
    baseHourlyRate: 175,
  },
];

export const INITIAL_BOOKINGS: Booking[] = [
  {
    id: 'bkg-001',
    reference: 'H20-2026-0042',
    customer: {
      fullName: 'Martijn van Dijk',
      email: 'm.vandijk@kpn-innovations.nl',
      phone: '+31 6 1234 5678',
      company: 'KPN Innovations B.V.',
      billingAddress: {
        street: 'Maanplein 55',
        postalCode: '2516 CK',
        city: 'Den Haag',
        country: 'Nederland',
      },
    },
    event: {
      name: 'KPN Annual Tech & Gaming Summit 2026',
      type: 'Bedrijfsevenement',
      participants: 280,
      description:
        'Jaarlijkse bijeenkomst van de innovatietak met keynote presentaties, esports toernooi voor medewerkers en netwerkborrel.',
      room: {
        id: 'rabo-esports-stadium',
        name: 'Rabo Esports Stadium',
      },
      date: '2026-11-18',
      alternativeDate: '2026-11-25',
      startTime: '09:30',
      endTime: '17:30',
      durationHours: 8,
    },
    selections: {
      activities: ['Esports Toernooi', 'Sim Racing Challenge', 'VR Arena Battle'],
      gamingPreferences: ['Rocket League competitie', 'Mario Kart op stadiumscherm'],
      vrPreferences: ['Beat Saber toernooi'],
      cateringSelections: [
        'Welkomstkoffie & patisserie',
        'Luxe broodjeslunch',
        'Borrelgarnituur & open bar',
      ],
      specialRequests:
        'Keynote spreker heeft eigen headset mic nodig. LED scherm 50m² moet logo in split-screen tonen.',
      customerNotes: 'Graag badges klaarleggen bij de hoofdingang.',
    },
    financial: {
      totalPrice: 12450.0,
      vatAmount: 2614.5,
      vatRate: 21,
      amountPaid: 12450.0,
      outstandingAmount: 0.0,
      paymentMethod: 'iDEAL (ABN AMRO)',
      paymentReference: 'STR-TXN-9842109',
      paymentDate: '2026-11-01 14:22',
      refundStatus: 'None',
    },
    reservation: {
      bookingReference: 'H20-2026-0042',
      createdAt: '2026-10-28 10:14',
      bookingStatus: 'Confirmed',
      availabilityVerified: true,
      adminApprovalStatus: 'Approved',
      internalNotes: [
        {
          id: 'note-1',
          text: 'Audiovisuele technicus Bas ingepland voor de hele dag. Zaalopstelling 280 stoelen theateropstelling met middenpad.',
          author: 'Admin Germain',
          createdAt: '2026-10-29 11:30',
        },
        {
          id: 'note-2',
          text: 'Betaling via iDEAL voldaan. Factuur automatisch verstuurd naar administratie KPN.',
          author: 'Admin Germain',
          createdAt: '2026-11-01 14:25',
        },
      ],
    },
  },
  {
    id: 'bkg-002',
    reference: 'H20-2026-0043',
    customer: {
      fullName: 'Sophie de Boer',
      email: 'sophie.deboer@coolblue.nl',
      phone: '+31 6 8765 4321',
      company: 'Coolblue Tech Support',
      billingAddress: {
        street: 'Weena 664',
        postalCode: '3012 CN',
        city: 'Rotterdam',
        country: 'Nederland',
      },
    },
    event: {
      name: 'Coolblue Esports Team Challenge',
      type: 'Teambuilding',
      participants: 45,
      description: 'Teambuilding dag met toernooivorm in de Lounge en Predator Gaming Room.',
      room: {
        id: 'h20-lounge-cafe',
        name: 'H20 Lounge Café',
      },
      date: '2026-11-22',
      alternativeDate: '2026-11-29',
      startTime: '13:00',
      endTime: '19:00',
      durationHours: 6,
    },
    selections: {
      activities: ['Gaming', 'VR Experience', 'Sim Racing'],
      gamingPreferences: ['FIFA/EA FC toernooi', 'Super Smash Bros'],
      vrPreferences: ['VR Flight simulator'],
      cateringSelections: ['Middag snackbuffet', 'Burger Bar diner', 'Drankenarrangement 4 uur'],
      specialRequests: '2 vegetarische en 1 glutenvrije maaltijd.',
      customerNotes: 'Graag prijsuitreiking microfoon in de lounge gereedzetten rond 18:30.',
    },
    financial: {
      totalPrice: 3850.0,
      vatAmount: 808.5,
      vatRate: 21,
      amountPaid: 1500.0,
      outstandingAmount: 2350.0,
      paymentMethod: 'Creditcard (Mastercard **** 4242)',
      paymentReference: 'STR-TXN-8371902',
      paymentDate: '2026-11-02 09:45',
      refundStatus: 'None',
    },
    reservation: {
      bookingReference: 'H20-2026-0043',
      createdAt: '2026-11-02 09:12',
      bookingStatus: 'Awaiting Payment',
      availabilityVerified: true,
      adminApprovalStatus: 'Approved',
      internalNotes: [
        {
          id: 'note-3',
          text: 'Aanbetaling van € 1.500 ontvangen. Restant (€ 2.350) moet uiterlijk 5 dagen voor event voldaan zijn.',
          author: 'Admin Germain',
          createdAt: '2026-11-02 10:00',
        },
      ],
    },
  },
  {
    id: 'bkg-003',
    reference: 'H20-2026-0044',
    customer: {
      fullName: 'Lars van Leeuwen',
      email: 'lars@nexustalent.io',
      phone: '+31 6 5544 3322',
      company: 'Nexus Talent Solutions',
      billingAddress: {
        street: 'Keizersgracht 421',
        postalCode: '1016 EK',
        city: 'Amsterdam',
        country: 'Nederland',
      },
    },
    event: {
      name: 'Nexus Bootcamp & Masterclass',
      type: 'Workshop',
      participants: 35,
      description:
        'Intensieve developer bootcamp met presentaties in de ochtend en hands-on gaming middag.',
      room: {
        id: 'aula',
        name: 'Aula',
      },
      date: '2026-11-26',
      startTime: '10:00',
      endTime: '16:00',
      durationHours: 6,
    },
    selections: {
      activities: ['Presentaties', 'Predator Gaming Sessie'],
      gamingPreferences: ['PC Gaming LAN setup'],
      vrPreferences: [],
      cateringSelections: ['Gezonde lunchbuffet', 'Energiedrankjes & gezonde snacks'],
      specialRequests: 'Extra stroomhaspels voor 35 laptops in de zaal.',
      customerNotes: 'Graag snel internet (bekabeld indien mogelijk voor docent).',
    },
    financial: {
      totalPrice: 2450.0,
      vatAmount: 514.5,
      vatRate: 21,
      amountPaid: 0.0,
      outstandingAmount: 2450.0,
      paymentMethod: 'Factuur op rekening (30 dagen)',
      paymentReference: 'INV-PENDING-44',
      paymentDate: '-',
      refundStatus: 'None',
    },
    reservation: {
      bookingReference: 'H20-2026-0044',
      createdAt: '2026-11-03 16:30',
      bookingStatus: 'Awaiting Approval',
      availabilityVerified: true,
      adminApprovalStatus: 'Pending',
      internalNotes: [
        {
          id: 'note-4',
          text: 'Klant vraagt om betaling op factuur. Kredietwaardigheid goedgekeurd door finance.',
          author: 'Admin Germain',
          createdAt: '2026-11-04 09:15',
        },
      ],
    },
  },
  {
    id: 'bkg-004',
    reference: 'H20-2026-0045',
    customer: {
      fullName: 'Anouk Visser',
      email: 'anouk.visser@visser-media.nl',
      phone: '+31 6 3322 1100',
      company: 'Visser Media & Streaming',
      billingAddress: {
        street: 'Media Park Boulevard 3',
        postalCode: '1217 WE',
        city: 'Hilversum',
        country: 'Nederland',
      },
    },
    event: {
      name: 'Streamers League Championship Live',
      type: 'Esports toernooi',
      participants: 12,
      description:
        'Live broadcast met bekende streamers uit de Benelux en directe stream naar Twitch.',
      room: {
        id: 'predator-gaming-room',
        name: 'Predator Gaming Room / Streaming Studio',
      },
      date: '2026-12-04',
      startTime: '14:00',
      endTime: '22:00',
      durationHours: 8,
    },
    selections: {
      activities: ['Streaming', 'Esports', 'Gaming'],
      gamingPreferences: ['Valorant 5v5', 'Apex Legends'],
      vrPreferences: [],
      cateringSelections: ['Energiedranken', 'Pizza slices buffet', 'Avond borrel'],
      specialRequests: 'Toegang tot 1 Gbps up/down glasvezel en OBS stream keys.',
      customerNotes: 'Crew komt om 12:30 voor soundcheck.',
    },
    financial: {
      totalPrice: 2980.0,
      vatAmount: 625.8,
      vatRate: 21,
      amountPaid: 2980.0,
      outstandingAmount: 0.0,
      paymentMethod: 'iDEAL (ING)',
      paymentReference: 'STR-TXN-1102948',
      paymentDate: '2026-11-04 11:00',
      refundStatus: 'None',
    },
    reservation: {
      bookingReference: 'H20-2026-0045',
      createdAt: '2026-11-04 10:45',
      bookingStatus: 'Confirmed',
      availabilityVerified: true,
      adminApprovalStatus: 'Approved',
      internalNotes: [
        {
          id: 'note-5',
          text: 'Streamers studio gereserveerd. Technicus Dave verzorgt stream overlay koppeling.',
          author: 'Admin Germain',
          createdAt: '2026-11-04 11:05',
        },
      ],
    },
  },
  {
    id: 'bkg-005',
    reference: 'H20-2026-0046',
    customer: {
      fullName: 'Daan Meijer',
      email: 'daan.meijer@meijer-consulting.com',
      phone: '+31 6 9988 7766',
      company: 'Meijer Consulting Group',
      billingAddress: {
        street: 'Zuidasplein 12',
        postalCode: '1082 MD',
        city: 'Amsterdam',
        country: 'Nederland',
      },
    },
    event: {
      name: 'Directie Strategie Heisessie',
      type: 'Vergadering',
      participants: 120,
      description: 'Jaarlijkse strategie meeting met directie en managers.',
      room: {
        id: 'rabo-meeting-room',
        name: 'Rabo Meeting Room',
      },
      date: '2026-12-10',
      startTime: '09:00',
      endTime: '17:00',
      durationHours: 8,
    },
    selections: {
      activities: ['Presentaties', 'Interactieve Workshops'],
      gamingPreferences: [],
      vrPreferences: ['VR Experience tijdens pauze'],
      cateringSelections: ['Volledig dagarrangement', '3-gangen diner in Lounge Café'],
      specialRequests: 'Behoefte aan U-vorm zaalopstelling en extra microfoons.',
      customerNotes: 'Klant vraagt bevestiging van maximale zaalcapaciteit.',
    },
    financial: {
      totalPrice: 5600.0,
      vatAmount: 1176.0,
      vatRate: 21,
      amountPaid: 0.0,
      outstandingAmount: 5600.0,
      paymentMethod: 'Overboeking',
      paymentReference: 'PENDING-WIRE',
      paymentDate: '-',
      refundStatus: 'None',
    },
    reservation: {
      bookingReference: 'H20-2026-0046',
      createdAt: '2026-11-04 11:30',
      bookingStatus: 'Awaiting Availability',
      availabilityVerified: false,
      adminApprovalStatus: 'Pending',
      internalNotes: [
        {
          id: 'note-6',
          text: 'Capaciteit van Rabo Meeting Room (100+) moet definitief getoetst worden voor 120 pax opstelling.',
          author: 'Admin Germain',
          createdAt: '2026-11-04 11:35',
        },
      ],
    },
  },
  {
    id: 'bkg-006',
    reference: 'H20-2026-0038',
    customer: {
      fullName: 'Emma van den Berg',
      email: 'emma@gamestorm.eu',
      phone: '+31 6 4433 2211',
      company: 'Gamestorm Events',
      billingAddress: {
        street: 'Catharijnesingel 80',
        postalCode: '3511 GK',
        city: 'Utrecht',
        country: 'Nederland',
      },
    },
    event: {
      name: 'Retro Arcade Night (Geannuleerd)',
      type: 'Gaming event',
      participants: 60,
      description: 'Evenement verplaatst wegens interne reorganisatie.',
      room: {
        id: 'h20-lounge-cafe',
        name: 'H20 Lounge Café',
      },
      date: '2026-10-15',
      startTime: '19:00',
      endTime: '23:30',
      durationHours: 4.5,
    },
    selections: {
      activities: ['Arcade experiences', 'Gaming'],
      gamingPreferences: ['Japanese Arcade', 'Retro consoles'],
      vrPreferences: [],
      cateringSelections: ['Snackmix', 'Drankmuntjes'],
      specialRequests: 'None',
      customerNotes: 'Reorganisatie.',
    },
    financial: {
      totalPrice: 1950.0,
      vatAmount: 409.5,
      vatRate: 21,
      amountPaid: 1950.0,
      outstandingAmount: 0.0,
      paymentMethod: 'iDEAL (Rabobank)',
      paymentReference: 'STR-TXN-654321',
      paymentDate: '2026-09-20 15:30',
      refundStatus: 'Full',
      refundAmount: 1950.0,
      refundReason: 'Geannuleerd binnen coulancetermijn; 100% restitutie verwerkt via Stripe.',
    },
    reservation: {
      bookingReference: 'H20-2026-0038',
      createdAt: '2026-09-15 14:00',
      bookingStatus: 'Refunded',
      availabilityVerified: true,
      adminApprovalStatus: 'Approved',
      internalNotes: [
        {
          id: 'note-7',
          text: 'Restitutie van € 1.950 goedgekeurd en uitgevoerd via beheerpaneel.',
          author: 'Admin Germain',
          createdAt: '2026-10-02 16:40',
        },
      ],
    },
  },
];

export const INITIAL_AVAILABILITY_BLOCKS: AvailabilityBlock[] = [
  {
    id: 'block-1',
    roomId: 'rabo-esports-stadium',
    roomName: 'Rabo Esports Stadium',
    date: '2026-12-15',
    startTime: '09:00',
    endTime: '17:00',
    reason: 'Besloten televisieopname & AV-onderhoud',
    type: 'Private Event',
    createdAt: '2026-11-01 10:00',
    createdBy: 'Admin Germain',
  },
  {
    id: 'block-2',
    roomId: 'predator-gaming-room',
    roomName: 'Predator Gaming Room / Streaming Studio',
    date: '2026-11-15',
    startTime: '08:00',
    endTime: '14:00',
    reason: 'Hardware upgrade RTX 5090 & bios flashen',
    type: 'Maintenance',
    createdAt: '2026-11-02 12:00',
    createdBy: 'Admin Germain',
  },
];

export const INITIAL_ACTIVITY_LOGS: ActivityLog[] = [
  {
    id: 'act-1',
    admin: 'Admin Germain',
    action: 'Zaalcapaciteit geverifieerd',
    previousValue: 'Rabo Esports Stadium: 50-1200',
    newValue: 'Geverifieerd volgens H20 documentatie',
    relatedItem: 'Rabo Esports Stadium',
    timestamp: '2026-11-04 10:00',
  },
  {
    id: 'act-2',
    admin: 'Admin Germain',
    action: 'Reservering goedgekeurd',
    previousValue: 'Status: Awaiting Approval',
    newValue: 'Status: Confirmed',
    relatedItem: 'Boeking H20-2026-0042',
    timestamp: '2026-11-04 10:15',
  },
  {
    id: 'act-3',
    admin: 'Admin Germain',
    action: 'Blokkade toegevoegd',
    previousValue: 'Beschikbaar',
    newValue: 'Geblokkeerd: Besloten opname',
    relatedItem: 'Rabo Esports Stadium (2026-12-15)',
    timestamp: '2026-11-04 10:30',
  },
];

export type CateringCategory =
  | 'Breakfast and lunch'
  | 'Sandwiches and wraps'
  | 'Salads and soups'
  | 'Hot and cold buffets'
  | 'Snacks and appetizers'
  | 'Hot and cold drinks'
  | 'Drinks and reception arrangements'
  | 'Dinner catering';

export interface CateringPackage {
  id: string;
  name: string;
  category: CateringCategory;
  categoryDutch: string;
  description: string;
  pricePerPerson: number | null; // null if unverified / on request
  priceDisplay: string; // e.g. "Prijs op aanvraag"
  status: 'Verified' | 'Subject to Confirmation' | 'Pending Admin Approval';
  isOfficialH20: boolean;
  minParticipants?: number;
  dietaryOptions?: string[];
  icon?: string;
  isActive: boolean;
}

export interface EventUpgrade {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number | null; // null if unconfirmed
  priceDisplay: string; // "Prijs op aanvraag" of "Standaard inbegrepen"
  status: 'Confirmed' | 'Subject to Confirmation' | 'Venue Facility Included';
  isStandardFacility: boolean;
  facilityNote?: string;
  requiresAvailabilityConfirmation: boolean;
  isActive: boolean;
  icon?: string;
}

export const INITIAL_CATERING_PACKAGES: CateringPackage[] = [
  {
    id: 'cat-live-bbq',
    name: 'Luxury Live BBQ Grill',
    category: 'Hot and cold buffets',
    categoryDutch: 'Warme & Koude Buffetten',
    description:
      'Live barbecue grill arrangement bereid op het buitenterras met diverse vlees-, vis- en vegetarische spiesen, verse salades en ambachtelijk stokbrood.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    dietaryOptions: ['Vlees', 'Vis', 'Vegetarisch', 'Halal mogelijk'],
    icon: '🥩',
    isActive: true,
  },
  {
    id: 'cat-lunch-buffet',
    name: 'Traditional Lunch Buffet',
    category: 'Breakfast and lunch',
    categoryDutch: 'Ontbijt & Lunch',
    description:
      'Ambachtelijk lunchbuffet met vers afgebakken broodjes, gevarieerd beleg, soep van de dag, gezonde salades en handfruit.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    dietaryOptions: ['Vegetarisch', 'Vegan opties', 'Halal opties'],
    icon: '🥪',
    isActive: true,
  },
  {
    id: 'cat-dinner-buffet',
    name: 'Extended Dinner Buffet',
    category: 'Dinner catering',
    categoryDutch: 'Diner Catering',
    description:
      'Uitgebreid warm en koud dinerbuffet met seizoensgerechten, warme hoofdgerechten, bijpassende garnituren en dessert.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    dietaryOptions: ['Vlees', 'Vis', 'Vega', 'Glutenvrij op aanvraag'],
    icon: '🍽️',
    isActive: true,
  },
  {
    id: 'cat-drinks-reception',
    name: 'Networking Drinks Package',
    category: 'Drinks and reception arrangements',
    categoryDutch: 'Drank- & Borrelarrangementen',
    description:
      'Drank- en borrelarrangement met tapbieren, huiswijnen, frisdranken en warm bittergarnituur in het sfeervolle H20 Lounge Café.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    icon: '🍻',
    isActive: true,
  },
  {
    id: 'cat-vega-catering',
    name: 'Vegetarian Catering',
    category: 'Salads and soups',
    categoryDutch: 'Salades & Soepen',
    description:
      '100% vegetarisch en plantaardig cateringarrangement met kleurrijke verse salades, seizoenssoepen en creatieve vega specialiteiten.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    dietaryOptions: ['100% Vegetarisch', 'Vegan', 'Lactosevrij'],
    icon: '🥗',
    isActive: true,
  },
  {
    id: 'cat-halal-catering',
    name: 'Certified Halal Catering',
    category: 'Hot and cold buffets',
    categoryDutch: 'Warme & Koude Buffetten',
    description:
      'Volledig halal gecertificeerde catering met warme en koude gerechten en hapjes bereid conform strikte halal voorschriften.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    dietaryOptions: ['100% Halal Gecertificeerd'],
    icon: '🥙',
    isActive: true,
  },
  {
    id: 'cat-barista-pastries',
    name: 'Barista Coffee & Fresh Pastries',
    category: 'Hot and cold drinks',
    categoryDutch: 'Warme & Koude Dranken',
    description:
      'Ontvangst met professionele barista espresso, latte en cappuccino van verse bonen, gecombineerd met diverse theesoorten en dagverse patisserie.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    icon: '☕',
    isActive: true,
  },
  {
    id: 'cat-alcohol-free',
    name: 'Alcohol-Free Drinks Package',
    category: 'Drinks and reception arrangements',
    categoryDutch: 'Drank- & Borrelarrangementen',
    description:
      'Verfrissend alcoholvrij arrangement met kwaliteitsfrisdranken, mineraalwaters, verse vruchtensappen en huisgemaakte mocktails.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    icon: '🍹',
    isActive: true,
  },
  {
    id: 'cat-sandwiches-wraps',
    name: 'Sandwiches & Wraps Assortiment',
    category: 'Sandwiches and wraps',
    categoryDutch: 'Broodjes & Wraps',
    description:
      'Vers belegde panini’s, ambachtelijke desembroodjes en goedgevulde wraps met gevarieerde vlees-, vis- en vega vullingen.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    icon: '🌯',
    isActive: true,
  },
  {
    id: 'cat-snacks-appetizers',
    name: 'Snacks & Bittergarnituur',
    category: 'Snacks and appetizers',
    categoryDutch: 'Snacks & Bittergarnituur',
    description:
      'Warm bittergarnituur met rundvleesbitterballen, kaastengels, miniloempia’s en knapperige vegetarische snacks inclusief mosterd en sauzen.',
    pricePerPerson: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isOfficialH20: true,
    icon: '🍢',
    isActive: true,
  },
];

export const INITIAL_EVENT_UPGRADES: EventUpgrade[] = [
  {
    id: 'upg-host',
    name: 'Esports tournament host and guidance',
    category: 'Toernooibegeleiding',
    description:
      'Officiële toernooileiding voor bracket management, toernooicoördinatie en presentatie.',
    price: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isStandardFacility: false,
    requiresAvailabilityConfirmation: true,
    icon: '🏆',
    isActive: true,
  },
  {
    id: 'upg-av-crew',
    name: 'Professional AV and technical crew',
    category: 'Audiovisueel & Techniek',
    description:
      'Toegewijde AV-technicus en regisseur voor showverlichting, Bose sound en cameraregie.',
    price: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isStandardFacility: false,
    requiresAvailabilityConfirmation: true,
    icon: '🎥',
    isActive: true,
  },
  {
    id: 'upg-broadcast',
    name: 'Livestream and broadcast production',
    category: 'Broadcast & Media',
    description:
      'Professionele meercamera livestream registratie naar platforms als Twitch, YouTube of LinkedIn.',
    price: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isStandardFacility: false,
    requiresAvailabilityConfirmation: true,
    icon: '📡',
    isActive: true,
  },
  {
    id: 'upg-dj',
    name: 'DJ and entertainment services',
    category: 'Entertainment',
    description:
      'Professionele DJ show met RGB feestverlichting en muziek afgestemd op de borrel of het feest.',
    price: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isStandardFacility: false,
    requiresAvailabilityConfirmation: true,
    icon: '🎧',
    isActive: true,
  },
  {
    id: 'upg-photobooth',
    name: 'Photobooth services – verify availability',
    category: 'Entertainment & Herinnering',
    description:
      'Interactieve fotobooth met direct printen en digitale sharing opties (beschikbaarheid onder voorbehoud van bevestiging).',
    price: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isStandardFacility: false,
    requiresAvailabilityConfirmation: true,
    icon: '📸',
    isActive: true,
  },
  {
    id: 'upg-led-branding',
    name: 'LED wall and event branding',
    category: 'Visuals & Branding',
    description:
      'Maatwerk motion graphics, branded templates en animaties voor de 50 m² LED wall. (Let op: het fysieke LED scherm zelf is een standaard zaalfaciliteit van het stadion).',
    price: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isStandardFacility: false,
    facilityNote:
      'Het fysieke 50 m² LED scherm is een vaste inbegrepen zaalfaciliteit van het Rabo Esports Stadium (€ 0,- toeslag). Deze optie betreft uitsluitend creatieve maatwerk contentproductie.',
    requiresAvailabilityConfirmation: false,
    icon: '🌟',
    isActive: true,
  },
  {
    id: 'upg-skybox',
    name: 'VIP Skybox access',
    category: 'VIP Experience',
    description:
      'Exclusieve toegang tot de VIP Skybox met panoramisch zicht over de stadium arena voor directie of speciale gasten.',
    price: null,
    priceDisplay: 'Prijs op aanvraag',
    status: 'Subject to Confirmation',
    isStandardFacility: false,
    requiresAvailabilityConfirmation: true,
    icon: '🥂',
    isActive: true,
  },
  {
    id: 'facility-led-screen',
    name: '50 m² High-Res LED Screen (Zaal Faciliteit)',
    category: 'Standaard Zaalfaciliteit',
    description:
      'Het fysieke 50 m² LED scherm is een vaste voorziening van het Rabo Esports Stadium. Standaard inbegrepen bij stadionhuur.',
    price: 0,
    priceDisplay: 'Standaard inbegrepen (€ 0,-)',
    status: 'Venue Facility Included',
    isStandardFacility: true,
    facilityNote:
      'Vaste zaalfaciliteit van Rabo Esports Stadium. Geen aparte toeslag voor het scherm zelf.',
    requiresAvailabilityConfirmation: false,
    icon: '🖥️',
    isActive: true,
  },
];
