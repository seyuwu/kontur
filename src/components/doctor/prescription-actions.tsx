"use client";
import {createContext,useContext,type ReactNode} from "react";
import {createPortal} from "react-dom";
export const PrescriptionActionContext=createContext<{host:HTMLDivElement|null;view:"questionnaires"|"treatment"}|null>(null);
export function PrescriptionAction({view,children}:{view:"questionnaires"|"treatment";children:ReactNode}){
  const context=useContext(PrescriptionActionContext);
  if(!context)return children;
  return context.view===view&&context.host ? createPortal(children,context.host) : null;
}
