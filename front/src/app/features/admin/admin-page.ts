import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Back-office — implémenté à l'étape 7. */
@Component({
  selector: 'app-admin-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1 class="text-3xl font-bold">Administration</h1>
    <div class="card mt-6 p-8 text-center text-ink-soft">Écran en construction (étape 7).</div>`,
})
export class AdminPage {}
