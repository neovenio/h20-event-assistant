import {
  Room,
  Booking,
  AvailabilityBlock,
  ActivityLog,
  Customer,
  InternalNote,
  CateringPackage,
  EventUpgrade,
} from './data/initial-data';

export type {
  Room,
  Booking,
  AvailabilityBlock,
  ActivityLog,
  Customer,
  InternalNote,
  CateringPackage,
  EventUpgrade,
};

export type ActiveTab =
  | 'dashboard'
  | 'event-builder'
  | 'my-proposals'
  | 'knowledge'
  | 'rooms'
  | 'activities'
  | 'catering'
  | 'admin';

export type AdminSubTab =
  | 'dashboard'
  | 'all-bookings'
  | 'calendar'
  | 'availability'
  | 'customers'
  | 'rooms'
  | 'catering-upgrades'
  | 'payments'
  | 'knowledge'
  | 'ai-settings'
  | 'activity-log';

export interface EventConfiguration {
  name: string;
  type: string;
  participants: number;
  date: string;
  alternativeDate?: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  budgetRange: string;
  budgetVatInclusive: boolean;
  selectedRoomId: string;
  selectedRoomName: string;
  additionalRooms: { id: string; name: string; price: number }[];
  selectedActivities: string[];
  gamingPreferences: string[];
  vrPreferences: string[];
  cateringSelections: string[];
  selectedAddons: { id: string; name: string; price: number }[];
  atmosphere: string;
  specialRequests: string;
  customerNotes: string;
}

export interface ProposalItem {
  id: string;
  title: string;
  config: EventConfiguration;
  createdAt: string;
  estimatedPrice: number;
  vatAmount: number;
  status: 'Draft' | 'Sent' | 'Booked';
}

export interface AiEventPlan {
  id?: string;
  name: string;
  type: string;
  participants: number;
  roomId: string;
  roomName: string;
  roomImage?: string;
  additionalRooms?: { id: string; name: string; price: number }[];
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  activities: string[];
  catering: string[];
  addons: { id: string; name: string; price: number }[];
  estimatedPrice: number;
  explanation?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  suggestedPlan?: AiEventPlan;
  isAdminUnlock?: boolean;
  responseTimeMs?: number;
}

export interface ActivityOption {
  id?: string;
  name: string;
  description: string;
  tag: string;
  price?: number | null;
  isActive?: boolean;
}
export interface ScrapedSource {
  id: string;
  url: string;
  title: string;
  content: string;
  imageUrl: string;
  retrievedAt: string;
  catalogueKind: string;
  suggestedItem?: Room | CateringPackage | EventUpgrade | ActivityOption;
}
