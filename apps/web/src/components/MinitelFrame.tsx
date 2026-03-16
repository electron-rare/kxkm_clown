import React from "react";

interface MinitelFrameProps {
  children: React.ReactNode;
  channel?: string;
  connected?: boolean;
}

export default function MinitelFrame({ children, channel, connected }: MinitelFrameProps) {
  return (
    <div className="minitel-frame">
      <div className="minitel-service-top">
        <span>3615 KXKM</span>
        <span>{channel || "#general"}</span>
        <span>GRATUIT</span>
      </div>
      {children}
      <div className="minitel-service-bottom">
        <span>F1=Sommaire</span>
        <span>F2=Suite</span>
        <span>F3=Retour</span>
        <span>F4=Annul</span>
        <span>F5=Envoi</span>
      </div>
    </div>
  );
}
