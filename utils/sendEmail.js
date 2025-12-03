import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API);
export const sendMail = async (config) => {
  const { data, error } = await resend.emails.send({
    from: "merohealth@sagarpariyar.com.np",
    to: config.to,
    subject: config.subject,
    html: config.text,
  });

  if (error) {
    return console.log(error);
  }

  console.log(`Mail sent to ${config.to}`);
};
