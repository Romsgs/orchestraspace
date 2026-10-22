import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  showLabel: string;
  hideLabel: string;
};

export function PasswordField({ label, showLabel, hideLabel, id, ...inputProps }: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? hideLabel : showLabel;

  return <div className="password-field">
    <label htmlFor={inputId}>{label}</label>
    <div className="password-input">
      <input {...inputProps} id={inputId} type={visible ? "text" : "password"}/>
      <button type="button" className="password-toggle" disabled={inputProps.disabled}
        aria-label={toggleLabel} title={toggleLabel} aria-controls={inputId} aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}>
        {visible ? <EyeOff size={19} aria-hidden="true"/> : <Eye size={19} aria-hidden="true"/>}
      </button>
    </div>
  </div>;
}
