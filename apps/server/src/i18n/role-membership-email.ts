export const ROLE_MEMBERSHIP_EMAIL_WORDS = {
  en: {
    roles: { staff: "Staff", supervisor: "Supervisor", manager: "Manager", admin: "Admin" },
    added: {
      subject: (role: string) => `Role added: ${role}`,
      text: (actor: string, role: string, when: string) =>
        `${actor} added you to ${role} on ${when}.`,
    },
    removed: {
      subject: (role: string) => `Role removed: ${role}`,
      text: (actor: string, role: string, when: string) =>
        `${actor} removed you from ${role} on ${when}.`,
    },
  },
  es: {
    roles: {
      staff: "Empleado",
      supervisor: "Supervisor",
      manager: "Encargado",
      admin: "Administrador",
    },
    added: {
      subject: (role: string) => `Rol añadido: ${role}`,
      text: (actor: string, role: string, when: string) =>
        `${actor} te añadió al rol ${role} el ${when}.`,
    },
    removed: {
      subject: (role: string) => `Rol quitado: ${role}`,
      text: (actor: string, role: string, when: string) =>
        `${actor} te quitó del rol ${role} el ${when}.`,
    },
  },
} as const;
