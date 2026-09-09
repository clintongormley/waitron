type Fetch = (input: string) => Promise<Response>;

interface RawAddress {
  Name: string;
  Address: string;
}

interface RawMessageSummary {
  ID: string;
  From: RawAddress;
  To: RawAddress[];
  Subject: string;
  Snippet: string;
  Created: string;
  Read: boolean;
}

interface RawMessage {
  ID: string;
  From: RawAddress;
  To: RawAddress[];
  Subject: string;
  Date: string;
  Text: string;
}

export interface TestEmailAddress {
  name: string;
  address: string;
}

export interface TestEmailSummary {
  id: string;
  from: TestEmailAddress;
  to: TestEmailAddress[];
  subject: string;
  snippet: string;
  createdAt: string;
  read: boolean;
}

export interface TestEmail {
  id: string;
  from: TestEmailAddress;
  to: TestEmailAddress[];
  subject: string;
  date: string;
  text: string;
}

export interface MailpitClient {
  list(): Promise<{ count: number; messages: TestEmailSummary[] }>;
  read(id: string): Promise<TestEmail>;
}

const projectAddress = (address: RawAddress): TestEmailAddress => ({
  name: address.Name,
  address: address.Address,
});

async function json<T>(fetchImpl: Fetch, url: string): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Mailpit request failed with ${response.status}`);
  return (await response.json()) as T;
}

/** Read the loopback-only Mailpit API and expose only the fields Waitron's inbox renders. */
export function createMailpitClient(baseUrl: string, fetchImpl: Fetch = fetch): MailpitClient {
  const base = baseUrl.replace(/\/+$/u, "");
  return {
    async list() {
      const result = await json<{ messages: RawMessageSummary[]; messages_count: number }>(
        fetchImpl,
        `${base}/api/v1/messages?limit=50`,
      );
      return {
        count: result.messages_count,
        messages: result.messages.map((message) => ({
          id: message.ID,
          from: projectAddress(message.From),
          to: message.To.map(projectAddress),
          subject: message.Subject,
          snippet: message.Snippet,
          createdAt: message.Created,
          read: message.Read,
        })),
      };
    },
    async read(id) {
      const message = await json<RawMessage>(
        fetchImpl,
        `${base}/api/v1/message/${encodeURIComponent(id)}`,
      );
      return {
        id: message.ID,
        from: projectAddress(message.From),
        to: message.To.map(projectAddress),
        subject: message.Subject,
        date: message.Date,
        text: message.Text,
      };
    },
  };
}
