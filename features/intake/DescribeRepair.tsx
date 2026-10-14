"use client";

import Page from "@/components/Page";
import type { StepClickStates, StepReasons } from "@/lib/runProgress";
import { MAX_PHOTOS } from "@/hooks/useIntake";
import type { Photo } from "@/lib/types";

interface DescribeRepairProps {
  description: string;
  onDescriptionChange: (value: string) => void;
  photos: Photo[];
  onAddPhotos: (files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
  onContinue: () => void;
  onAllRuns: () => void;
  /* Timeline as navigation: click a reachable step to jump to it. */
  onStepClick?: (step: number) => void;
  clickStates?: StepClickStates;
  reasons?: StepReasons;
}

export default function DescribeRepair({
  description,
  onDescriptionChange,
  photos,
  onAddPhotos,
  onRemovePhoto,
  onContinue,
  onAllRuns,
  onStepClick,
  clickStates,
  reasons,
}: DescribeRepairProps) {
  return (
    <Page
      currentStep={1}
      onAllRuns={onAllRuns}
      onStepClick={onStepClick}
      clickStates={clickStates}
      reasons={reasons}
    >
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
        <section className="flex min-w-0 flex-1 flex-col">
          <h1 className="mb-3">Describe your repair</h1>
          <p className="text-[17px] leading-relaxed text-muted">
            Tell us what happened. You can add photos to show the object and
            the repair area.
          </p>

          <label htmlFor="description">
            What happened and what is broken or missing?
          </label>

          <textarea
            id="description"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="For example: The cabinet handle broke off and the broken piece is missing."
            rows={10}
          />
        </section>

        <aside className="flex w-full shrink-0 flex-col lg:w-[400px]">
          <div className="flex items-baseline justify-between gap-3">
            <h2>Add photos</h2>
            <span className="shrink-0 text-sm text-[#7a828d]">
              {photos.length}/{MAX_PHOTOS}
            </span>
          </div>

          <p className="mt-1 text-sm">
            Optional. Add photos if they help show the object and the repair
            area.
          </p>

          {photos.length < MAX_PHOTOS && (
            <label className="mt-3 flex w-full cursor-pointer items-center justify-center rounded-[10px] border border-brand bg-white px-4.5 py-3 font-semibold text-brand hover:bg-[#f6f8ff]">
              + Add photos
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  onAddPhotos(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </label>
          )}

          {photos.length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-3">
              {photos.map((photo) => (
                <li
                  key={photo.id}
                  className="overflow-hidden rounded-xl border border-line-light bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewUrl}
                    alt={photo.file.name}
                    className="block h-[150px] w-full bg-[#eceff2] object-cover"
                  />
                  <div className="p-2.5">
                    <div className="break-anywhere text-sm text-[#59616d]">
                      {photo.file.name}
                    </div>
                    <button
                      type="button"
                      className="mt-2 w-full bg-transparent px-0 py-1.5 text-sm font-medium text-[#a22c2c] hover:bg-transparent hover:underline"
                      onClick={() => onRemovePhoto(photo.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="mt-6 w-full"
            onClick={onContinue}
            disabled={!description.trim() || photos.length === 0}
          >
            Continue →
          </button>
        </aside>
      </div>
    </Page>
  );
}
