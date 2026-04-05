export type PersonSource = 'manual' | 'phonebook' | 'email_invite' | 'self';

export type Person = {
    id: string;
    name: string;
    avatarUrl: string;
    email?: string;
    authUserId?: string;
    isClaimed?: boolean;
    source?: PersonSource;
};

export type Currency = string;

export interface CurrencyDetails {
    code: Currency;
    name: string;
    symbol: string;
}

const allCurrencies: CurrencyDetails[] = [
    { code: 'AED', name: 'United Arab Emirates Dirham', symbol: 'د.إ' },
    { code: 'AFN', name: 'Afghan Afghani', symbol: '؋' },
    { code: 'ALL', name: 'Albanian Lek', symbol: 'L' },
    { code: 'AMD', name: 'Armenian Dram', symbol: '֏' },
    { code: 'ANG', name: 'Netherlands Antillean Guilder', symbol: 'ƒ' },
    { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz' },
    { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
    { code: 'AUD', name: 'Australian Dollar', symbol: '$' },
    { code: 'AWG', name: 'Aruban Florin', symbol: 'ƒ' },
    { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼' },
    { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM' },
    { code: 'BBD', name: 'Barbadian Dollar', symbol: '$' },
    { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
    { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв' },
    { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب' },
    { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu' },
    { code: 'BMD', name: 'Bermudan Dollar', symbol: '$' },
    { code: 'BND', name: 'Brunei Dollar', symbol: '$' },
    { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.' },
    { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
    { code: 'BSD', name: 'Bahamian Dollar', symbol: '$' },
    { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.' },
    { code: 'BWP', name: 'Botswanan Pula', symbol: 'P' },
    { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br' },
    { code: 'BZD', name: 'Belize Dollar', symbol: 'BZ$' },
    { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
    { code: 'CDF', name: 'Congolese Franc', symbol: 'FC' },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
    { code: 'CLP', name: 'Chilean Peso', symbol: '$' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'COP', name: 'Colombian Peso', symbol: '$' },
    { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡' },
    { code: 'CUP', name: 'Cuban Peso', symbol: '$' },
    { code: 'CVE', name: 'Cape Verdean Escudo', symbol: '$' },
    { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
    { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj' },
    { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
    { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$' },
    { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج' },
    { code: 'EGP', name: 'Egyptian Pound', symbol: '£' },
    { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk' },
    { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'FJD', name: 'Fijian Dollar', symbol: '$' },
    { code: 'FKP', name: 'Falkland Islands Pound', symbol: '£' },
    { code: 'GBP', name: 'British Pound Sterling', symbol: '£' },
    { code: 'GEL', name: 'Georgian Lari', symbol: '₾' },
    { code: 'GGP', name: 'Guernsey Pound', symbol: '£' },
    { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵' },
    { code: 'GIP', name: 'Gibraltar Pound', symbol: '£' },
    { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D' },
    { code: 'GNF', name: 'Guinean Franc', symbol: 'FG' },
    { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q' },
    { code: 'GYD', name: 'Guyanaese Dollar', symbol: '$' },
    { code: 'HKD', name: 'Hong Kong Dollar', symbol: '$' },
    { code: 'HNL', name: 'Honduran Lempira', symbol: 'L' },
    { code: 'HRK', name: 'Croatian Kuna', symbol: 'kn' },
    { code: 'HTG', name: 'Haitian Gourde', symbol: 'G' },
    { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
    { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
    { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪' },
    { code: 'IMP', name: 'Manx pound', symbol: '£' },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د' },
    { code: 'IRR', name: 'Iranian Rial', symbol: '﷼' },
    { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr' },
    { code: 'JEP', name: 'Jersey Pound', symbol: '£' },
    { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$' },
    { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JD' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
    { code: 'KGS', name: 'Kyrgystani Som', symbol: 'с' },
    { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
    { code: 'KMF', name: 'Comorian Franc', symbol: 'CF' },
    { code: 'KPW', name: 'North Korean Won', symbol: '₩' },
    { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
    { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD' },
    { code: 'KYD', name: 'Cayman Islands Dollar', symbol: '$' },
    { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸' },
    { code: 'LAK', name: 'Laotian Kip', symbol: '₭' },
    { code: 'LBP', name: 'Lebanese Pound', symbol: 'ل.ل' },
    { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
    { code: 'LRD', name: 'Liberian Dollar', symbol: '$' },
    { code: 'LSL', name: 'Lesotho Loti', symbol: 'L' },
    { code: 'LYD', name: 'Libyan Dinar', symbol: 'LD' },
    { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD' },
    { code: 'MDL', name: 'Moldovan Leu', symbol: 'L' },
    { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
    { code: 'MKD', name: 'Macedonian Denar', symbol: 'ден' },
    { code: 'MMK', name: 'Myanma Kyat', symbol: 'K' },
    { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮' },
    { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP$' },
    { code: 'MRO', name: 'Mauritanian Ouguiya', symbol: 'UM' },
    { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨' },
    { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf' },
    { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK' },
    { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
    { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
    { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT' },
    { code: 'NAD', name: 'Namibian Dollar', symbol: '$' },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
    { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$' },
    { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
    { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨' },
    { code: 'NZD', name: 'New Zealand Dollar', symbol: '$' },
    { code: 'OMR', name: 'Omani Rial', symbol: '﷼' },
    { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.' },
    { code: 'PEN', name: 'Peruvian Nuevo Sol', symbol: 'S/.' },
    { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K' },
    { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
    { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
    { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
    { code: 'PYG', name: 'Paraguayan Guarani', symbol: '₲' },
    { code: 'QAR', name: 'Qatari Rial', symbol: '﷼' },
    { code: 'RON', name: 'Romanian Leu', symbol: 'lei' },
    { code: 'RSD', name: 'Serbian Dinar', symbol: 'Дин.' },
    { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
    { code: 'RWF', name: 'Rwandan Franc', symbol: 'R₣' },
    { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
    { code: 'SBD', name: 'Solomon Islands Dollar', symbol: '$' },
    { code: 'SCR', name: 'Seychellois Rupee', symbol: '₨' },
    { code: 'SDG', name: 'Sudanese Pound', symbol: 'ج.س.' },
    { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: '$' },
    { code: 'SHP', name: 'Saint Helena Pound', symbol: '£' },
    { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le' },
    { code: 'SOS', name: 'Somali Shilling', symbol: 'S' },
    { code: 'SRD', name: 'Surinamese Dollar', symbol: '$' },
    { code: 'SSP', name: 'South Sudanese Pound', symbol: '£' },
    { code: 'STD', name: 'São Tomé and Príncipe Dobra', symbol: 'Db' },
    { code: 'SVC', name: 'Salvadoran Colón', symbol: '$' },
    { code: 'SYP', name: 'Syrian Pound', symbol: '£' },
    { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'L' },
    { code: 'THB', name: 'Thai Baht', symbol: '฿' },
    { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'SM' },
    { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'T' },
    { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت' },
    { code: 'TOP', name: 'Tongan Paʻanga', symbol: 'T$' },
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
    { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$' },
    { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
    { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
    { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴' },
    { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
    { code: 'USD', name: 'United States Dollar', symbol: '$' },
    { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U' },
    { code: 'UZS', name: 'Uzbekistan Som', symbol: 'soʻm' },
    { code: 'VEF', name: 'Venezuelan Bolívar Fuerte', symbol: 'Bs' },
    { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
    { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VT' },
    { code: 'WST', name: 'Samoan Tala', symbol: 'WS$' },
    { code: 'XAF', name: 'CFA Franc BEAC', symbol: 'FCFA' },
    { code: 'XCD', name: 'East Caribbean Dollar', symbol: '$' },
    { code: 'XDR', name: 'Special Drawing Rights', symbol: 'SDR' },
    { code: 'XOF', name: 'CFA Franc BCEAO', symbol: 'CFA' },
    { code: 'XPF', name: 'CFP Franc', symbol: '₣' },
    { code: 'YER', name: 'Yemeni Rial', symbol: '﷼' },
    { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
    { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK' },
    { code: 'ZWL', name: 'Zimbabwean Dollar', symbol: '$' }
].sort((a, b) => a.name.localeCompare(b.name));

const inrIndex = allCurrencies.findIndex(c => c.code === 'INR');
if (inrIndex > -1) {
    const inr = allCurrencies.splice(inrIndex, 1)[0];
    allCurrencies.unshift(inr);
}


export const CURRENCIES: CurrencyDetails[] = allCurrencies;

export const GROUP_TYPES = [
    { value: 'trip', label: 'Vacation or Trip' },
    { value: 'family_trip', label: 'Family Trip' },
    { value: 'flat_sharing', label: 'Flat Sharing' },
    { value: 'expense_management', label: 'Expense Management' },
    { value: 'other', label: 'Other' },
] as const;

export type GroupType = typeof GROUP_TYPES[number]['value'];

export type Group = {
    id: string;
    name: string;
    members: string[]; // array of Person ids
    currency: Currency;
    groupType: GroupType;
    tripStartDate?: string; // YYYY-MM-DD when groupType is a trip
    tripEndDate?: string;   // YYYY-MM-DD when groupType is a trip
    createdBy?: string; // user id of creator/owner
    isArchived?: boolean;
    enableCuteIcons?: boolean; // Whether to auto-append emojis to transaction descriptions
};

export const TAGS = [
    'Food',
    'Groceries',
    'Transport',
    'Travel',
    'Housing',
    'Utilities',
    'Entertainment',
    'Shopping',
    'Health',
    'Other',
] as const;

export type Tag = typeof TAGS[number];

export type PaymentSourceType = 'Credit Card' | 'UPI' | 'Cash' | 'Other';

export interface CreditCardDetails {
    issuer: string; // e.g., 'Visa', 'Mastercard'
    last4: string; // last 4 digits
}

export interface UPIDetails {
    appName: string; // e.g., 'Google Pay', 'PhonePe'
    upiId?: string; // e.g., 'user@okicici' - optional for privacy
}

export type PaymentSource = {
    id: string;
    name: string; // User-defined name, e.g., "My HDFC Visa"
    type: PaymentSourceType;
    details?: CreditCardDetails | UPIDetails;
    /** Whether the source is selectable for new transactions */
    isActive?: boolean;
};

export type SplitMode = 'equal' | 'unequal' | 'percentage' | 'shares';

export type SplitParticipant = {
    personId: string;
    /**
     * Represents amount, percentage, or shares depending on the split mode.
     * For 'equal' mode we store a nominal value (e.g. 1) and derive the actual
     * share while calculating balances.
     */
    value: number;
};

export type Split = {
    mode: SplitMode;
    participants: SplitParticipant[];
};

export type TransactionType = 'expense' | 'settlement' | 'adjustment';

export interface Payer {
    personId: string;
    amount: number;
}

export type Transaction = {
    id: string;
    groupId: string;
    description: string;
    amount: number;
    paidById: string; // Person id (Primary payer for BC)
    payers?: Payer[]; // Optional, multiple payers
    split: Split;
    date: string; // YYYY-MM-DD
    tag: Tag;
    paymentSourceId?: string;
    comment?: string;
    type: TransactionType;
};

export type Filter = {
    tag: string; // 'all' or a Tag
    dateRange?: {
        start: string; // YYYY-MM-DD
        end: string;   // YYYY-MM-DD
    }
};

export type SortOption = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc';

// ============================================================================
// INVITE SYSTEM TYPES
// ============================================================================

export interface GroupInvite {
    id: string;
    groupId: string;
    inviteToken: string;
    invitedBy: string; // Person ID who created the invite
    expiresAt: string; // ISO date string
    maxUses: number | null; // null = unlimited uses
    currentUses: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EmailInvite {
    id: string;
    groupId: string;
    groupInviteId: string;
    email: string;
    invitedBy: string; // Person ID who sent the invite
    sentAt: string;
    mailersendMessageId: string | null;
    mailersendStatus: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';
    status: 'pending' | 'accepted' | 'expired';
    acceptedAt: string | null;
    acceptedBy: string | null; // Person ID who accepted
    createdAt: string;
}

// API Request/Response types for invite system
export interface CreateInviteRequest {
    groupId: string;
    emails?: string[]; // Optional: if provided, send email invites
    maxUses?: number | null; // Default: null (unlimited)
    expiresInDays?: number; // Default: 30
}

export interface CreateInviteResponse {
    invite: GroupInvite;
    inviteUrl: string;
    emailInvites?: EmailInvite[]; // If emails were provided
}

export interface ValidateInviteResponse {
    isValid: boolean;
    invite?: GroupInvite;
    group?: Group;
    error?: string;
}

export interface AcceptInviteRequest {
    inviteToken: string;
    personId: string; // Person who is accepting the invite
}

export interface AcceptInviteResponse {
    success: boolean;
    group?: Group;
    error?: string;
}
