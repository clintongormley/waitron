export const ACCOUNT_EMAIL_OUTPUTS = [
  {
    purpose: "invitation",
    locale: "en-GB",
    message: {
      to: "ann@example.test",
      subject: "Set up your Waitron account",
      text: "Hello Ann O'Brien <&> \"Lewis\",\n\nUse this link to set up your account:\nhttps://dashboard.example.test/account?token=fixture&next='profile'\n\nThis single-use link expires at 8 Sept 2026, 12:30 UTC.\nIf you did not expect this email, you can ignore it.\nPrivacy notice\nhttps://restaurant.example/privacy?lang='en'&quote=\"x\"",
      html: '<p>Hello Ann O&#39;Brien &lt;&amp;&gt; &quot;Lewis&quot;,</p>\n<p><a href="https://dashboard.example.test/account?token=fixture&amp;next=&#39;profile&#39;">Set up your account</a></p>\n\n<p>This single-use link expires at 8 Sept 2026, 12:30 UTC.</p>\n<p>If you did not expect this email, you can ignore it.</p>\n<p><a href="https://restaurant.example/privacy?lang=&#39;en&#39;&amp;quote=&quot;x&quot;">Privacy notice</a></p>',
      from: "Waitron <hello@example.test>",
    },
  },
  {
    purpose: "password_reset",
    locale: "en-GB",
    message: {
      to: "ann@example.test",
      subject: "Reset your Waitron password",
      text: "Hello Ann O'Brien <&> \"Lewis\",\n\nUse this link to reset your password:\nhttps://dashboard.example.test/account?token=fixture&next='profile'\n\nThis single-use link expires at 8 Sept 2026, 12:30 UTC.\nIf you did not expect this email, you can ignore it.\nPrivacy notice\nhttps://restaurant.example/privacy?lang='en'&quote=\"x\"",
      html: '<p>Hello Ann O&#39;Brien &lt;&amp;&gt; &quot;Lewis&quot;,</p>\n<p><a href="https://dashboard.example.test/account?token=fixture&amp;next=&#39;profile&#39;">Reset your password</a></p>\n\n<p>This single-use link expires at 8 Sept 2026, 12:30 UTC.</p>\n<p>If you did not expect this email, you can ignore it.</p>\n<p><a href="https://restaurant.example/privacy?lang=&#39;en&#39;&amp;quote=&quot;x&quot;">Privacy notice</a></p>',
      from: "Waitron <hello@example.test>",
    },
  },
  {
    purpose: "email_change",
    locale: "en-GB",
    message: {
      to: "ann@example.test",
      subject: "Confirm your new Waitron email",
      text: "Hello Ann O'Brien <&> \"Lewis\",\n\nUse this link to confirm your new email address:\nhttps://dashboard.example.test/account?token=fixture&next='profile'\n\nEnter 123456 in your Waitron profile. This code expires at 8 Sept 2026, 12:10 UTC.\n\nThis single-use link expires at 8 Sept 2026, 12:30 UTC.\nIf you did not expect this email, you can ignore it.\nPrivacy notice\nhttps://restaurant.example/privacy?lang='en'&quote=\"x\"",
      html: '<p>Hello Ann O&#39;Brien &lt;&amp;&gt; &quot;Lewis&quot;,</p>\n<p><a href="https://dashboard.example.test/account?token=fixture&amp;next=&#39;profile&#39;">Open your Waitron profile</a></p>\n<p>Enter 123456 in your Waitron profile. This code expires at 8 Sept 2026, 12:10 UTC.</p>\n<p>This single-use link expires at 8 Sept 2026, 12:30 UTC.</p>\n<p>If you did not expect this email, you can ignore it.</p>\n<p><a href="https://restaurant.example/privacy?lang=&#39;en&#39;&amp;quote=&quot;x&quot;">Privacy notice</a></p>',
      from: "Waitron <hello@example.test>",
    },
  },
  {
    purpose: "invitation",
    locale: "es-ES",
    message: {
      to: "ann@example.test",
      subject: "Configura tu cuenta de Waitron",
      text: "Hola Ann O'Brien <&> \"Lewis\",\n\nUsa este enlace para configurar tu cuenta:\nhttps://dashboard.example.test/account?token=fixture&next='profile'\n\nEste enlace de un solo uso caduca el 8 sept 2026, 12:30 UTC.\nSi no esperabas este correo, puedes ignorarlo.\nAviso de privacidad\nhttps://restaurant.example/privacy?lang='en'&quote=\"x\"",
      html: '<p>Hola Ann O&#39;Brien &lt;&amp;&gt; &quot;Lewis&quot;,</p>\n<p><a href="https://dashboard.example.test/account?token=fixture&amp;next=&#39;profile&#39;">Configura tu cuenta</a></p>\n\n<p>Este enlace de un solo uso caduca el 8 sept 2026, 12:30 UTC.</p>\n<p>Si no esperabas este correo, puedes ignorarlo.</p>\n<p><a href="https://restaurant.example/privacy?lang=&#39;en&#39;&amp;quote=&quot;x&quot;">Aviso de privacidad</a></p>',
      from: "Waitron <hello@example.test>",
    },
  },
  {
    purpose: "password_reset",
    locale: "es-ES",
    message: {
      to: "ann@example.test",
      subject: "Restablece tu contraseña de Waitron",
      text: "Hola Ann O'Brien <&> \"Lewis\",\n\nUsa este enlace para restablecer tu contraseña:\nhttps://dashboard.example.test/account?token=fixture&next='profile'\n\nEste enlace de un solo uso caduca el 8 sept 2026, 12:30 UTC.\nSi no esperabas este correo, puedes ignorarlo.\nAviso de privacidad\nhttps://restaurant.example/privacy?lang='en'&quote=\"x\"",
      html: '<p>Hola Ann O&#39;Brien &lt;&amp;&gt; &quot;Lewis&quot;,</p>\n<p><a href="https://dashboard.example.test/account?token=fixture&amp;next=&#39;profile&#39;">Restablece tu contraseña</a></p>\n\n<p>Este enlace de un solo uso caduca el 8 sept 2026, 12:30 UTC.</p>\n<p>Si no esperabas este correo, puedes ignorarlo.</p>\n<p><a href="https://restaurant.example/privacy?lang=&#39;en&#39;&amp;quote=&quot;x&quot;">Aviso de privacidad</a></p>',
      from: "Waitron <hello@example.test>",
    },
  },
  {
    purpose: "email_change",
    locale: "es-ES",
    message: {
      to: "ann@example.test",
      subject: "Confirma tu nuevo correo de Waitron",
      text: "Hola Ann O'Brien <&> \"Lewis\",\n\nUsa este enlace para confirmar tu nueva dirección de correo:\nhttps://dashboard.example.test/account?token=fixture&next='profile'\n\nIntroduce 123456 en tu perfil de Waitron. Este código caduca el 8 sept 2026, 12:10 UTC.\n\nEste enlace de un solo uso caduca el 8 sept 2026, 12:30 UTC.\nSi no esperabas este correo, puedes ignorarlo.\nAviso de privacidad\nhttps://restaurant.example/privacy?lang='en'&quote=\"x\"",
      html: '<p>Hola Ann O&#39;Brien &lt;&amp;&gt; &quot;Lewis&quot;,</p>\n<p><a href="https://dashboard.example.test/account?token=fixture&amp;next=&#39;profile&#39;">Abre tu perfil de Waitron</a></p>\n<p>Introduce 123456 en tu perfil de Waitron. Este código caduca el 8 sept 2026, 12:10 UTC.</p>\n<p>Este enlace de un solo uso caduca el 8 sept 2026, 12:30 UTC.</p>\n<p>Si no esperabas este correo, puedes ignorarlo.</p>\n<p><a href="https://restaurant.example/privacy?lang=&#39;en&#39;&amp;quote=&quot;x&quot;">Aviso de privacidad</a></p>',
      from: "Waitron <hello@example.test>",
    },
  },
  {
    purpose: "password_reset",
    locale: "ES",
    message: {
      to: "ann@example.test",
      subject: "Reset your Waitron password",
      text: "Hello Ann O'Brien <&> \"Lewis\",\n\nUse this link to reset your password:\nhttps://dashboard.example.test/account?token=fixture&next='profile'\n\nThis single-use link expires at 8 sept 2026, 12:30 UTC.\nIf you did not expect this email, you can ignore it.\nPrivacy notice\nhttps://restaurant.example/privacy?lang='en'&quote=\"x\"",
      html: '<p>Hello Ann O&#39;Brien &lt;&amp;&gt; &quot;Lewis&quot;,</p>\n<p><a href="https://dashboard.example.test/account?token=fixture&amp;next=&#39;profile&#39;">Reset your password</a></p>\n\n<p>This single-use link expires at 8 sept 2026, 12:30 UTC.</p>\n<p>If you did not expect this email, you can ignore it.</p>\n<p><a href="https://restaurant.example/privacy?lang=&#39;en&#39;&amp;quote=&quot;x&quot;">Privacy notice</a></p>',
      from: "Waitron <hello@example.test>",
    },
  },
] as const;
