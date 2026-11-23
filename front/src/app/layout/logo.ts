import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Logo Orkidea (fichier src/assets/logo.svg, à remplacer par le logo définitif). */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img src="assets/logo.svg" alt="Orkidea" [style.height.px]="height()" class="w-auto" />`,
})
export class Logo {
  readonly height = input(32);
}
