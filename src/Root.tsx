import React from 'react';
import {Composition} from 'remotion';
import {Anatomy} from './anatomy/Anatomy';
import {Lock} from './lock/Lock';
import {Watch} from './watch/Watch';
import {Gpu} from './gpu/Gpu';
import {Burger} from './burger/Burger';

// Toutes les vidéos : 1080×1350 (4:5), 30 images/s, 450 images = 15 s, 120 BPM.
const common = {durationInFrames: 450, fps: 30, width: 1080, height: 1350} as const;

export const RemotionRoot = () => (
  <>
    <Composition id="Manette" component={Anatomy} {...common} />
    <Composition id="Serrure" component={Lock} {...common} />
    <Composition id="Montre" component={Watch} {...common} />
    <Composition id="CarteGraphique" component={Gpu} {...common} />
    <Composition id="Burger" component={Burger} {...common} />
  </>
);
