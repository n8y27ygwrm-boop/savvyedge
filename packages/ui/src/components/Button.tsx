import * as React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function Button({ children, ...props }: ButtonProps) {
  return <button className="px-4 py-2 bg-blue-500 text-white rounded" {...props}>{children}</button>;
}
