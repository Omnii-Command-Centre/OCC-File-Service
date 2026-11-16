const MONDAY_API_URL = 'https://api.monday.com/v2';

function getApiToken(): string {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error('MONDAY_API_TOKEN environment variable is not set');
  }
  return token;
}

async function mondayQuery(query: string, variables?: Record<string, any>): Promise<any> {
  const token = getApiToken();
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
      'API-Version': '2025-10',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Monday.com API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Monday.com GraphQL error: ${JSON.stringify(data.errors)}`);
  }

  return data;
}

// Board IDs
const BOARDS = {
  LEADS: '18423385364',
  CONTACTS: '18414644419',
  COMPANIES: '18419062431',
} as const;

const GROUPS = {
  LEADS: 'group_mm3nvzmp',
  CONTACTS_ACTIVE: 'group_mm4kgwxq',
  COMPANIES_INDIVIDUAL: 'group_mm2mc8va',
  COMPANIES_UMBRELLA: 'group_mm4kyx08',
} as const;

// --- Search functions ---

export async function searchContacts(
  name?: string,
  email?: string
): Promise<any[]> {
  const rules: any[] = [];
  if (name) {
    rules.push({
      column_id: 'name',
      compare_value: [name],
      operator: 'contains_text',
    });
  }
  if (email) {
    rules.push({
      column_id: 'email_mm3nqhch',
      compare_value: [email],
      operator: 'contains_text',
    });
  }

  if (rules.length === 0) return [];

  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        items_page(limit: 50, query_params: {
          rules: ${JSON.stringify(rules).replace(/"([^"]+)":/g, '$1:')}
        }) {
          items {
            id
            name
            column_values {
              id
              column { title }
              text
              value
            }
          }
        }
      }
    }
  `;

  const result = await mondayQuery(query, { boardId: [BOARDS.CONTACTS] });
  return result.data?.boards?.[0]?.items_page?.items || [];
}

export async function searchCompanies(name: string): Promise<any[]> {
  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        items_page(limit: 50, query_params: {
          rules: [{
            column_id: "name",
            compare_value: ["${name.replace(/"/g, '\\"')}"],
            operator: contains_text
          }]
        }) {
          items {
            id
            name
            column_values {
              id
              column { title }
              text
              value
            }
          }
        }
      }
    }
  `;

  const result = await mondayQuery(query, { boardId: [BOARDS.COMPANIES] });
  return result.data?.boards?.[0]?.items_page?.items || [];
}

export async function searchLeads(name: string): Promise<any[]> {
  const query = `
    query ($boardId: [ID!]!) {
      boards(ids: $boardId) {
        items_page(limit: 50, query_params: {
          rules: [{
            column_id: "name",
            compare_value: ["${name.replace(/"/g, '\\"')}"],
            operator: contains_text
          }]
        }) {
          items {
            id
            name
            group { title }
            column_values {
              id
              column { title }
              text
              value
            }
          }
        }
      }
    }
  `;

  const result = await mondayQuery(query, { boardId: [BOARDS.LEADS] });
  return result.data?.boards?.[0]?.items_page?.items || [];
}

// --- Create functions ---

interface CreateLeadFields {
  name: string;
  type?: string;
  stage?: string;
  leadSource?: string;
  ownerIds?: number[];
  description?: string;
  nextAction?: string;
  notes?: string;
  companyItemIds?: string[];
  contactItemIds?: string[];
  sourceContactItemIds?: string[];
  estimatedValue?: number;
  link?: string;
  doNotContactUntil?: string;
  contactStatus?: string;
}

export async function createLead(fields: CreateLeadFields): Promise<any> {
  const columnValues: Record<string, any> = {};

  if (fields.type) {
    columnValues['color_mm3z7z4y'] = { label: fields.type };
  }
  if (fields.stage) {
    columnValues['color_mm3nwmby'] = { label: fields.stage };
  }
  if (fields.leadSource) {
    columnValues['color_mm3znz5w'] = { label: fields.leadSource };
  }
  if (fields.ownerIds && fields.ownerIds.length > 0) {
    columnValues['multiple_person_mm3ne5t9'] = {
      personsAndTeams: fields.ownerIds.map((id) => ({ id, kind: 'person' })),
    };
  }
  if (fields.description) {
    columnValues['long_text_mm3nj5be'] = { text: fields.description };
  }
  if (fields.nextAction) {
    columnValues['long_text_mm5gctnz'] = { text: fields.nextAction };
  }
  if (fields.notes) {
    columnValues['long_text_mm3nxtbg'] = { text: fields.notes };
  }
  if (fields.companyItemIds && fields.companyItemIds.length > 0) {
    columnValues['board_relation_mm3na1jz'] = {
      item_ids: fields.companyItemIds.map(Number),
    };
  }
  if (fields.contactItemIds && fields.contactItemIds.length > 0) {
    columnValues['board_relation_mm3nr7kc'] = {
      item_ids: fields.contactItemIds.map(Number),
    };
  }
  if (fields.sourceContactItemIds && fields.sourceContactItemIds.length > 0) {
    columnValues['board_relation_mm5gk15'] = {
      item_ids: fields.sourceContactItemIds.map(Number),
    };
  }
  if (fields.estimatedValue !== undefined) {
    columnValues['numeric_mm3n3fe5'] = String(fields.estimatedValue);
  }
  if (fields.link) {
    columnValues['link_mm5nm7vp'] = { url: fields.link, text: fields.link };
  }
  if (fields.doNotContactUntil) {
    columnValues['date_mm7ym1hs'] = { date: fields.doNotContactUntil };
  }
  if (fields.contactStatus) {
    columnValues['color_mm7ytaja'] = { label: fields.contactStatus };
  }

  const today = new Date().toISOString().split('T')[0];
  columnValues['date_mm3nwvvt'] = { date: today };
  columnValues['date_mm3npv3h'] = { date: today };

  const mutation = `
    mutation {
      create_item(
        board_id: ${BOARDS.LEADS},
        group_id: "${GROUPS.LEADS}",
        item_name: "${fields.name.replace(/"/g, '\\"')}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
        name
      }
    }
  `;

  const result = await mondayQuery(mutation);
  return result.data?.create_item;
}

interface CreateContactFields {
  firstName: string;
  lastName: string;
  email?: string;
  jobTitle?: string;
  vocation?: string;
  company?: string;
  ownerIds?: number[];
  phone?: string;
  stateLocation?: string;
  notes?: string;
  companyItemIds?: string[];
  tags?: string[];
}

export async function createContact(fields: CreateContactFields): Promise<any> {
  const columnValues: Record<string, any> = {};

  columnValues['text_mm3ny82v'] = fields.firstName;
  columnValues['text_mm3np7g3'] = fields.lastName;

  if (fields.email) {
    columnValues['email_mm3nqhch'] = { email: fields.email, text: fields.email };
  }
  if (fields.jobTitle) {
    columnValues['text_mm3n5y2r'] = fields.jobTitle;
  }
  if (fields.vocation) {
    columnValues['dropdown_mm3nrwhp'] = { labels: [fields.vocation] };
  }
  if (fields.company) {
    columnValues['text_mm3ng41j'] = fields.company;
  }
  if (fields.ownerIds && fields.ownerIds.length > 0) {
    columnValues['multiple_person_mm3njm7s'] = {
      personsAndTeams: fields.ownerIds.map((id) => ({ id, kind: 'person' })),
    };
  }
  if (fields.phone) {
    columnValues['text_mm47faa4'] = fields.phone;
  }
  if (fields.stateLocation) {
    columnValues['text_mm47746s'] = fields.stateLocation;
  }
  if (fields.notes) {
    columnValues['long_text_mm47kfhq'] = { text: fields.notes };
  }
  if (fields.companyItemIds && fields.companyItemIds.length > 0) {
    columnValues['board_relation_mm4z49yq'] = {
      item_ids: fields.companyItemIds.map(Number),
    };
  }

  const itemName = `${fields.firstName} ${fields.lastName}`;
  const mutation = `
    mutation {
      create_item(
        board_id: ${BOARDS.CONTACTS},
        group_id: "${GROUPS.CONTACTS_ACTIVE}",
        item_name: "${itemName.replace(/"/g, '\\"')}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
        name
      }
    }
  `;

  const result = await mondayQuery(mutation);
  const item = result.data?.create_item;

  if (item && fields.tags && fields.tags.length > 0) {
    for (const tagName of fields.tags) {
      await createOrGetTag(tagName, BOARDS.CONTACTS);
    }
  }

  return item;
}

interface CreateCompanyFields {
  name: string;
  website?: string;
  phone?: string;
  industry?: string;
  ownerIds?: number[];
  notes?: string;
  isUmbrella?: boolean;
  umbrellaCompanyItemIds?: string[];
}

export async function createCompany(fields: CreateCompanyFields): Promise<any> {
  const columnValues: Record<string, any> = {};

  if (fields.website) {
    columnValues['text_mm1xmwdk'] = fields.website;
  }
  if (fields.phone) {
    columnValues['text_mm2m5rrn'] = fields.phone;
  }
  if (fields.industry) {
    columnValues['dropdown_mm1hf4w2'] = { labels: [fields.industry] };
  }
  if (fields.ownerIds && fields.ownerIds.length > 0) {
    columnValues['person'] = {
      personsAndTeams: [{ id: fields.ownerIds[0], kind: 'person' }],
    };
  }
  if (fields.notes) {
    columnValues['long_text_mm1ht53y'] = { text: fields.notes };
  }
  if (fields.umbrellaCompanyItemIds && fields.umbrellaCompanyItemIds.length > 0) {
    columnValues['board_relation_mm4k7kc3'] = {
      item_ids: fields.umbrellaCompanyItemIds.map(Number),
    };
  }

  const groupId = fields.isUmbrella ? GROUPS.COMPANIES_UMBRELLA : GROUPS.COMPANIES_INDIVIDUAL;

  const mutation = `
    mutation {
      create_item(
        board_id: ${BOARDS.COMPANIES},
        group_id: "${groupId}",
        item_name: "${fields.name.replace(/"/g, '\\"')}",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
        name
      }
    }
  `;

  const result = await mondayQuery(mutation);
  return result.data?.create_item;
}

// --- Update functions ---

export async function updateItem(
  boardId: string,
  itemId: string,
  columnValues: Record<string, any>
): Promise<any> {
  const mutation = `
    mutation {
      change_multiple_column_values(
        board_id: ${boardId},
        item_id: ${itemId},
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
        name
      }
    }
  `;

  const result = await mondayQuery(mutation);
  return result.data?.change_multiple_column_values;
}

export async function updateLeadRelations(
  leadId: string,
  companyItemIds?: string[],
  contactItemIds?: string[],
  sourceContactItemIds?: string[]
): Promise<void> {
  const columnValues: Record<string, any> = {};

  if (companyItemIds) {
    columnValues['board_relation_mm3na1jz'] = {
      item_ids: companyItemIds.map(Number),
    };
  }
  if (contactItemIds) {
    columnValues['board_relation_mm3nr7kc'] = {
      item_ids: contactItemIds.map(Number),
    };
  }
  if (sourceContactItemIds) {
    columnValues['board_relation_mm5gk15'] = {
      item_ids: sourceContactItemIds.map(Number),
    };
  }

  if (Object.keys(columnValues).length > 0) {
    await updateItem(BOARDS.LEADS, leadId, columnValues);
  }
}

// --- Timeline / CRM activity functions ---

export async function createTimelineItem(
  itemId: string,
  customActivityId: string,
  title: string,
  summary: string,
  timestamp: string
): Promise<any> {
  const mutation = `
    mutation {
      create_timeline_item(
        item_id: ${itemId},
        custom_activity_id: "${customActivityId}",
        title: "${title.replace(/"/g, '\\"')}",
        content: "${summary.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
        timestamp: "${timestamp}"
      ) {
        id
      }
    }
  `;

  const result = await mondayQuery(mutation);
  return result.data?.create_timeline_item;
}

export async function createTimelineNote(
  itemId: string,
  content: string
): Promise<any> {
  const mutation = `
    mutation {
      create_timeline_note(
        item_id: ${itemId},
        content: "${content.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
      ) {
        id
      }
    }
  `;

  const result = await mondayQuery(mutation);
  return result.data?.create_timeline_note;
}

export async function getCustomActivities(): Promise<any[]> {
  const query = `
    query {
      custom_activities {
        id
        name
        icon_id
        color
      }
    }
  `;

  const result = await mondayQuery(query);
  return result.data?.custom_activities || [];
}

export async function getTimelineItems(itemId: string): Promise<any[]> {
  const query = `
    query {
      items(ids: [${itemId}]) {
        timeline {
          ... on TimelineCustomActivityItem {
            id
            title
            content
            custom_activity_id
            created_at
          }
          ... on TimelineNoteItem {
            id
            content
            created_at
          }
        }
      }
    }
  `;

  const result = await mondayQuery(query);
  return result.data?.items?.[0]?.timeline || [];
}

// --- Tag management ---

export async function createOrGetTag(
  tagName: string,
  boardId: string
): Promise<{ id: number; name: string }> {
  const mutation = `
    mutation {
      create_or_get_tag(tag_name: "${tagName.replace(/"/g, '\\"')}", board_id: ${boardId}) {
        id
        name
      }
    }
  `;

  const result = await mondayQuery(mutation);
  return result.data?.create_or_get_tag;
}

// --- Monday update (for appending notes to items) ---

export async function createUpdate(
  itemId: string,
  body: string
): Promise<any> {
  const mutation = `
    mutation {
      create_update(
        item_id: ${itemId},
        body: "${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
      ) {
        id
      }
    }
  `;

  const result = await mondayQuery(mutation);
  return result.data?.create_update;
}

// --- Batch search for deduplication ---

export async function searchAllBoards(name: string): Promise<{
  contacts: any[];
  companies: any[];
  leads: any[];
}> {
  const [contacts, companies, leads] = await Promise.all([
    searchContacts(name),
    searchCompanies(name),
    searchLeads(name),
  ]);

  return { contacts, companies, leads };
}

// --- Helper: format item for context ---

function formatColumnValues(item: any): Record<string, string> {
  const cols: Record<string, string> = {};
  if (item.column_values) {
    for (const cv of item.column_values) {
      if (cv.text) {
        cols[cv.column?.title || cv.id] = cv.text;
      }
    }
  }
  return cols;
}

export function formatSearchResults(results: {
  contacts: any[];
  companies: any[];
  leads: any[];
}): string {
  let context = '';

  if (results.contacts.length > 0) {
    context += `### Matching Contacts (${results.contacts.length})\n`;
    for (const item of results.contacts) {
      const cols = formatColumnValues(item);
      context += `- **${item.name}** (ID: ${item.id})`;
      if (cols['Company']) context += ` | Company: ${cols['Company']}`;
      if (cols['Job Title']) context += ` | Title: ${cols['Job Title']}`;
      if (cols['Email']) context += ` | Email: ${cols['Email']}`;
      if (cols['Phone Number']) context += ` | Phone: ${cols['Phone Number']}`;
      if (cols['Contact Owner']) context += ` | Owner: ${cols['Contact Owner']}`;
      context += '\n';
    }
  }

  if (results.companies.length > 0) {
    context += `\n### Matching Companies (${results.companies.length})\n`;
    for (const item of results.companies) {
      const cols = formatColumnValues(item);
      context += `- **${item.name}** (ID: ${item.id})`;
      if (cols['Website URL']) context += ` | Web: ${cols['Website URL']}`;
      if (cols['Industry']) context += ` | Industry: ${cols['Industry']}`;
      context += '\n';
    }
  }

  if (results.leads.length > 0) {
    context += `\n### Matching Leads (${results.leads.length})\n`;
    for (const item of results.leads) {
      const cols = formatColumnValues(item);
      context += `- **${item.name}** (ID: ${item.id})`;
      if (item.group?.title) context += ` | Group: ${item.group.title}`;
      if (cols['Stage']) context += ` | Stage: ${cols['Stage']}`;
      if (cols['Owner']) context += ` | Owner: ${cols['Owner']}`;
      context += '\n';
    }
  }

  if (!context) {
    context = 'No matching records found in Contacts, Companies or Leads.\n';
  }

  return context;
}

export { BOARDS, GROUPS };
