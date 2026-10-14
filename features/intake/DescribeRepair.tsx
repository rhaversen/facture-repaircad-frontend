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
  onNewRun: () => void;
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
  onNewRun,
  onStepClick,
  clickStates,
  reasons,
}: DescribeRepairProps) {
  return (
    <Page
      currentStep={1}
      onNewRun={onNewRun}
      onStepClick={onStepClick}
      clickStates={clickStates}
      reasons={reasons}
      title="Describe your repair"
      subtitle={
        <>
          Tell us what happened. You can add photos to show the object and the
          repair area.
        </>
      }
    >
      <label htmlFor="description">
        What happened and what is broken or missing?
      </label>

      <textarea
        id="description"
        value={description}
        onChange={(event) => onDescriptionChange(event.target.value)}
        placeholder="For example: The cabinet handle broke off and the broken piece is missing."
        rows={6}
      />

      <h2 className="mt-7">Add photos</h2>

      <p>
        Optional. Add photos if they help show the object and the repair
        area. Up to {MAX_PHOTOS}.
      </p>

      {photos.length < MAX_PHOTOS ? (
        <label className="mt-2 mb-7 inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-brand bg-white px-4.5 py-3 font-semibold text-brand hover:bg-[#f6f8ff]">
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
      ) : (
        <p className="mt-2 mb-7 text-sm text-[#a05a00]">
          Maximum of {MAX_PHOTOS} photos reached. Remove one to add another.
        </p>
      )}

      {photos.length > 0 && (
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 max-[640px]:grid-cols-1">
          {photos.map((photo) => (
            <div className="overflow-hidden rounded-xl border border-line-light bg-white" key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={photo.file.name} className="block h-[180px] w-full bg-[#eceff2] object-cover" />
              <div className="p-3.5">
                <div className="break-anywhere text-sm text-[#59616d]">{photo.file.name}</div>
                <button
                  type="button"
                  className="mt-3 w-full bg-transparent px-0 py-2 text-[#a22c2c] font-medium hover:bg-transparent hover:underline"
                  onClick={() => onRemovePhoto(photo.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!description.trim() || photos.length === 0}
        >
          Continue →
        </button>
      </div>
    </Page>
  );
}
