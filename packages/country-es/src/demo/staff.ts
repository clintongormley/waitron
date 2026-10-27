import type { CountryDemoPerson } from "@waitron/country";
export const DEMO_STAFF = [
  {
    displayName: "Marta Ruiz",
    role: "manager",
    email: "manager@demo.waitron.local",
    dashboardLogin: true,
  },
  {
    displayName: "Javier Torres",
    role: "supervisor",
    dashboardLogin: false,
    email: "javier@demo.waitron.local",
  },
  {
    displayName: "Lucía Fernández",
    role: "staff",
    dashboardLogin: false,
    email: "lucia@demo.waitron.local",
  },
  {
    displayName: "Diego Molina",
    role: "staff",
    dashboardLogin: false,
    email: "diego@demo.waitron.local",
  },
  {
    displayName: "Sofía Navarro",
    role: "staff",
    dashboardLogin: false,
    email: "sofia@demo.waitron.local",
  },
] as const satisfies readonly CountryDemoPerson[];
